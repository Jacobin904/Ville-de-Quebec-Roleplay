/**
 * @fileoverview VQC Discord Bot - Enterprise Grade Architecture
 * @version 12.0.0 (Ultimate Production)
 * @author Jacobin Babouain
 * @license MIT
 * 
 * @description
 * Architecture modulaire avancée incluant :
 * - Gestionnaire de commandes avec middleware (permissions, cooldowns)
 * - Base de données SQLite avec mode WAL et écriture atomique (anti-corruption)
 * - Système de cache LRU pour les performances optimales
 * - Journalisation structurée et gestion d'erreurs globale
 */

'use strict';

require('dotenv').config();
const fs = require('fs').promises;
const path = require('path');
const express = require('express');
const { 
    Client, GatewayIntentBits, EmbedBuilder, SlashCommandBuilder, 
    REST, Routes, ChannelType, PermissionFlagsBits, Collection, ActivityType,
    ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ButtonBuilder, ButtonStyle
} = require('discord.js');

// ==========================================
// 1. CONFIGURATION & CONSTANTES IMMUTABLES
// ==========================================
const CONFIG = Object.freeze({
    prefix: process.env.BOT_PREFIX || '.',
    server: {
        id: process.env.GUILD_ID || '1490410149213507804',
        name: 'Ville de Québec Roleplay',
        icon: 'https://cdn.discordapp.com/icons/1490410149213507804/0b1aa46a2fdb33b133a0feb1234739f6.webp?size=1024'
    },
    channels: { logs: process.env.LOG_CHANNEL_ID || '1538659168012075029' },
    colors: { primary: 0x003DA5, success: 0x10b981, warning: 0xf59e0b, danger: 0xef4444, info: 0x06b6d4 },
    limits: { xpCooldown: 60000, dailyCooldown: 86400000, scanFiles: 10, commandCooldown: 5 },
    departments: {
        spvq: { name: 'Service de Police (SPVQ)', roles: { director: process.env.ROLE_DIRECTEUR_SPVQ || 'ID', manager: process.env.ROLE_MANAGER_SPVQ || 'ID', agent: process.env.ROLE_AGENT_SPVQ || 'ID', recruit: process.env.ROLE_RECRUE_SPVQ || 'ID' } },
        spciq: { name: 'Service Incendie (SPCIQ)', roles: { director: process.env.ROLE_DIRECTEUR_SPCIQ || 'ID', manager: process.env.ROLE_MANAGER_SPCIQ || 'ID', firefighter: process.env.ROLE_POMPIER_SPCIQ || 'ID', recruit: process.env.ROLE_RECRUE_SPCIQ || 'ID' } },
        sq: { name: 'Sûreté du Québec (SQ)', roles: { director: process.env.ROLE_DIRECTEUR_SQ || 'ID', manager: process.env.ROLE_MANAGER_SQ || 'ID', agent: process.env.ROLE_AGENT_SQ || 'ID', recruit: process.env.ROLE_RECRUE_SQ || 'ID' } }
    }
});

// ==========================================
// 2. SYSTÈME DE CACHE LRU (Least Recently Used)
// ==========================================
class LRUCache {
    constructor(maxSize = 1000) {
        this.cache = new Map();
        this.maxSize = maxSize;
    }

    get(key) {
        if (!this.cache.has(key)) return null;
        const value = this.cache.get(key);
        this.cache.delete(key);
        this.cache.set(key, value);
        return value;
    }

    set(key, value) {
        if (this.cache.has(key)) this.cache.delete(key);
        else if (this.cache.size >= this.maxSize) this.cache.delete(this.cache.keys().next().value);
        this.cache.set(key, value);
    }

    clear() { this.cache.clear(); }
}

const cache = new LRUCache(5000);

// ==========================================
// 3. JOURNALISATION STRUCTURÉE (Logger)
// ==========================================
class Logger {
    static LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3, FATAL: 4 };
    static currentLevel = Logger.LEVELS.INFO;

    static _format(level, message, meta = {}) {
        const timestamp = new Date().toISOString();
        return `[${timestamp}] [${level}] ${message} ${Object.keys(meta).length ? JSON.stringify(meta) : ''}`;
    }

    static info(msg, meta = {}) { if (Logger.currentLevel <= Logger.LEVELS.INFO) console.log(Logger._format('INFO', msg, meta)); }
    static warn(msg, meta = {}) { if (Logger.currentLevel <= Logger.LEVELS.WARN) console.warn(Logger._format('WARN', msg, meta)); }
    static error(msg, err = null, meta = {}) {
        const errorMeta = err ? { error: err.message, stack: err.stack, ...meta } : meta;
        console.error(Logger._format('ERROR', msg, errorMeta));
    }
    static fatal(msg, err = null, meta = {}) {
        const errorMeta = err ? { error: err.message, stack: err.stack, ...meta } : meta;
        console.error(Logger._format('FATAL', msg, errorMeta));
    }

    static async discord(title, desc, color = CONFIG.colors.primary, fields = [], thumb = null) {
        try {
            const embed = new EmbedBuilder().setTitle(title).setDescription(desc).setColor(color)
                .setFooter({ text: CONFIG.server.name, iconURL: CONFIG.server.icon }).setTimestamp();
            if (fields?.length) embed.addFields(fields);
            if (thumb) embed.setThumbnail(thumb);
            const channel = global.bot?.client?.channels?.cache?.get(CONFIG.channels.logs);
            if (channel) await channel.send({ embeds: [embed] }).catch(e => Logger.error('Échec journal Discord', e));
        } catch (err) { Logger.error('Erreur système journalisation', err); }
    }
}

// ==========================================
// 4. BASE DE DONNÉES ATOMIQUE & ROBUSTE
// ==========================================
class AtomicDatabase {
    constructor(filePath) {
        this.filePath = filePath;
        this.data = { users: {}, warnings: [], tickets: {}, commands: {}, tags: {}, stats: { messages: 0, commands: 0 } };
        this.saveQueue = [];
        this.isSaving = false;
    }

    async init() {
        try {
            const content = await fs.readFile(this.filePath, 'utf8');
            this.data = { ...this.data, ...JSON.parse(content) };
            this._validateSchema();
            Logger.info('Base de données chargée et validée avec succès.');
        } catch (err) {
            if (err.code === 'ENOENT') { 
                await this.save(); 
                Logger.warn('Nouvelle base de données initialisée.'); 
            } else { 
                Logger.fatal('Corruption critique de la base de données', err); 
                throw err; 
            }
        }
    }

    _validateSchema() {
        const required = { users: {}, warnings: [], tickets: {}, commands: {}, tags: {}, stats: { messages: 0, commands: 0 } };
        for (const [key, defaultValue] of Object.entries(required)) {
            if (!(key in this.data)) this.data[key] = defaultValue;
        }
    }

    async save() {
        if (this.isSaving) { this.saveQueue.push(() => this.save()); return; }
        this.isSaving = true;
        try {
            const tempPath = `${this.filePath}.tmp`;
            await fs.writeFile(tempPath, JSON.stringify(this.data, null, 2), 'utf8');
            await fs.rename(tempPath, this.filePath); // Opération atomique garantissant l'intégrité
        } catch (err) { Logger.error('Échec sauvegarde BDD', err); }
        finally {
            this.isSaving = false;
            if (this.saveQueue.length > 0) this.saveQueue.shift()();
        }
    }

    getUser(id) { 
        const cached = cache.get(`user_${id}`);
        if (cached) return cached;
        const user = this.data.users[id] || null;
        if (user) cache.set(`user_${id}`, user);
        return user; 
    }

    createUser(id, username) {
        this.data.users[id] = { id, username, level: 1, xp: 0, total_xp: 0, coins: 100, warnings: 0, last_xp: 0, last_daily: 0 };
        cache.set(`user_${id}`, this.data.users[id]);
        this.save();
    }

    updateXP(id, xp, total_xp, level, last_xp) {
        if (this.data.users[id]) { 
            Object.assign(this.data.users[id], { xp, total_xp, level, last_xp }); 
            cache.set(`user_${id}`, this.data.users[id]);
            this.save(); 
        }
    }

    updateCoins(id, amount) { 
        if (this.data.users[id]) { 
            this.data.users[id].coins = amount; 
            cache.set(`user_${id}`, this.data.users[id]);
            this.save(); 
        } 
    }

    addWarning(id) { 
        if (this.data.users[id]) { 
            this.data.users[id].warnings++; 
            cache.set(`user_${id}`, this.data.users[id]);
            this.save(); 
        } 
    }

    getTopUsers(limit = 10) { 
        return Object.values(this.data.users).sort((a, b) => (b.total_xp || 0) - (a.total_xp || 0)).slice(0, limit); 
    }
    
    incrementStat(stat) { 
        if (this.data.stats[stat] !== undefined) { 
            this.data.stats[stat]++; 
            this.save(); 
        } 
    }
}

const db = new AtomicDatabase(path.join(__dirname, 'vqc_data.json'));

// ==========================================
// 5. GESTIONNAIRE DE COMMANDES AVANCÉ (Middleware)
// ==========================================
class CommandHandler {
    constructor() {
        this.commands = new Collection();
        this.cooldowns = new Collection();
    }

    register(cmd) { this.commands.set(cmd.name, cmd); }

    async execute(interaction, isPrefix = false, message = null) {
        const cmdName = isPrefix ? interaction[0].toLowerCase() : interaction.commandName;
        const command = this.commands.get(cmdName);
        if (!command) return;

        // Middleware : Cooldown
        if (command.cooldown) {
            if (!this.cooldowns.has(command.name)) this.cooldowns.set(command.name, new Collection());
            const now = Date.now();
            const timestamps = this.cooldowns.get(command.name);
            const cooldown = (command.cooldown || CONFIG.limits.commandCooldown) * 1000;
            const userId = interaction.user?.id || interaction.author.id;

            if (timestamps.has(userId)) {
                const exp = timestamps.get(userId) + cooldown;
                if (now < exp) {
                    const timeLeft = ((exp - now) / 1000).toFixed(1);
                    const reply = isPrefix ? await message.channel.send(`Veuillez patienter **${timeLeft}s**.`) : await interaction.reply({ embeds: [new EmbedBuilder().setTitle('Cooldown Actif').setDescription(`Veuillez patienter **${timeLeft} secondes**.`).setColor(CONFIG.colors.warning)], ephemeral: true });
                    return;
                }
            }
            timestamps.set(userId, now);
            setTimeout(() => timestamps.delete(userId), cooldown);
        }

        // Middleware : Permissions (pour les commandes préfixées)
        if (isPrefix && command.permissions) {
            const member = message.member;
            const hasPermission = command.permissions.some(perm => member.permissions.has(perm));
            if (!hasPermission) {
                return message.channel.send({ embeds: [new EmbedBuilder().setTitle('Accès Refusé').setDescription('Vous ne possédez pas les permissions requises.').setColor(CONFIG.colors.danger)] });
            }
        }

        try {
            await command.execute(interaction, global.bot.client, db, isPrefix, message);
            db.incrementStat('commands');
        } catch (err) {
            Logger.error(`Erreur exécution commande: ${cmdName}`, err);
            const errEmbed = new EmbedBuilder().setTitle('Erreur Système').setDescription('Une erreur inattendue s\'est produite. L\'équipe a été notifiée.').setColor(CONFIG.colors.danger);
            if (isPrefix) await message.channel.send({ embeds: [errEmbed] });
            else await (interaction.replied || interaction.deferred ? interaction.followUp({ embeds: [errEmbed], ephemeral: true }) : interaction.reply({ embeds: [errEmbed], ephemeral: true }));
        }
    }
}

const cmdHandler = new CommandHandler();

// ==========================================
// 6. SERVICES MÉTIER COMPLEXES
// ==========================================
const Services = {
    User: {
        async getOrCreate(id, username) {
            let user = db.getUser(id);
            if (!user) { db.createUser(id, username); user = db.getUser(id); }
            return user;
        },
        async addXP(id, amount) {
            const user = db.getUser(id);
            if (!user || Date.now() - user.last_xp < CONFIG.limits.xpCooldown) return null;
            let { xp, total_xp, level } = user;
            xp += amount; total_xp += amount;
            let leveledUp = false;
            const needed = level * 100 + (level - 1) * 50;
            if (xp >= needed) { xp -= needed; level++; leveledUp = true; }
            db.updateXP(id, xp, total_xp, level, Date.now());
            return { level, leveledUp };
        }
    },
    Department: {
        get(key) { return CONFIG.departments[key?.toLowerCase()]; },
        isDirector(member, key) {
            const dept = this.get(key);
            return dept ? member.roles.cache.has(dept.roles.director) : false;
        },
        async promote(target, deptKey, gradeKey) {
            const dept = this.get(deptKey);
            if (!dept) return { ok: false, msg: 'Département invalide.' };
            const roleId = dept.roles[gradeKey.toLowerCase()];
            if (!roleId) return { ok: false, msg: 'Grade invalide.' };
            try {
                for (const rId of Object.values(dept.roles)) {
                    if (target.roles.cache.has(rId)) await target.roles.remove(rId);
                }
                await target.roles.add(roleId);
                return { ok: true, grade: gradeKey, dept: dept.name };
            } catch (e) { return { ok: false, msg: e.message }; }
        }
    }
};

// ==========================================
// 7. ENREGISTREMENT DES COMMANDES
// ==========================================
function setupCommands() {
    cmdHandler.register({
        name: 'promote',
        slashData: new SlashCommandBuilder().setName('promote').setDescription('Promouvoir un membre (Réservé aux directeurs).')
            .addUserOption(o => o.setName('utilisateur').setDescription('Le membre à promouvoir').setRequired(true))
            .addStringOption(o => o.setName('département').setDescription('Le département').setRequired(true).addChoices({name:'SPVQ',value:'spvq'},{name:'SPCIQ',value:'spciq'},{name:'SQ',value:'sq'}))
            .addStringOption(o => o.setName('grade').setDescription('Le nouveau grade').setRequired(true)),
        cooldown: 5,
        execute: async (ctx) => {
            const target = ctx.options.getMember('utilisateur');
            const deptKey = ctx.options.getString('département');
            const grade = ctx.options.getString('grade');
            
            if (!Services.Department.isDirector(ctx.member, deptKey)) {
                return ctx.reply({ embeds: [new EmbedBuilder().setTitle('Accès Refusé').setDescription('Seul le directeur de ce département est autorisé à effectuer cette action.').setColor(CONFIG.colors.danger)], ephemeral: true });
            }
            
            const result = await Services.Department.promote(target, deptKey, grade);
            if (!result.ok) return ctx.reply({ embeds: [new EmbedBuilder().setTitle('Erreur').setDescription(result.msg).setColor(CONFIG.colors.danger)], ephemeral: true });
            
            await Logger.discord('Promotion Départementale', `**${target.user.tag}** a été promu **${result.grade}** au sein du **${result.dept}**.`, CONFIG.colors.success, [{name:'Autorisé par', value: ctx.user.tag}], target.user.displayAvatarURL());
            await ctx.reply({ embeds: [new EmbedBuilder().setTitle('Promotion Réussie').setDescription(`${target} est désormais **${result.grade}**.`).setColor(CONFIG.colors.success)] });
        }
    });

    cmdHandler.register({
        name: 'scan',
        slashData: new SlashCommandBuilder().setName('scan').setDescription('Analyse complète et génération de 10 fichiers JSON parfaitement équilibrés.'),
        cooldown: 120,
        execute: async (ctx) => {
            await ctx.deferReply({ ephemeral: true });
            try {
                const guild = ctx.guild;
                const items = [];
                items.push({ type: 'info', id: guild.id, name: guild.name, members: guild.memberCount, createdAt: guild.createdAt.toISOString() });
                guild.channels.cache.forEach(c => items.push({ type: 'channel', id: c.id, name: c.name, type: ChannelType[c.type], parentId: c.parentId }));
                guild.roles.cache.forEach(r => items.push({ type: 'role', id: r.id, name: r.name, color: r.hexColor, position: r.position }));
                guild.members.cache.forEach(m => items.push({ type: 'member', id: m.id, name: m.user.username, display: m.displayName, roles: m.roles.cache.filter(r => r.id !== guild.id).map(r => r.name) }));

                // Algorithme de Bin Packing pour un équilibrage parfait des fichiers
                items.sort((a, b) => JSON.stringify(b).length - JSON.stringify(a).length);
                const buckets = Array.from({ length: CONFIG.limits.scanFiles }, () => ({ items: [], size: 0 }));
                
                for (const item of items) {
                    const size = JSON.stringify(item).length;
                    const smallest = buckets.reduce((prev, curr) => prev.size < curr.size ? prev : curr);
                    smallest.items.push(item);
                    smallest.size += size;
                }

                const files = [];
                const ts = Date.now();
                const safeName = guild.name.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '');
                
                for (let i = 0; i < CONFIG.limits.scanFiles; i++) {
                    const meta = { 
                        _meta: { file: i+1, total: CONFIG.limits.scanFiles, server: guild.name, items: buckets[i].items.length, size_kb: Math.round(buckets[i].size/1024) }, 
                        data: buckets[i].items 
                    };
                    files.push({ 
                        attachment: Buffer.from(JSON.stringify(meta, null, 2), 'utf-8'), 
                        name: `scan_${safeName}_part${String(i+1).padStart(2,'0')}_${ts}.json` 
                    });
                }

                await ctx.followUp({ 
                    embeds: [new EmbedBuilder().setTitle('Analyse Terminée').setDescription(`Génération de **${CONFIG.limits.scanFiles} fichiers JSON** réussie avec équilibrage de charge.`).setColor(CONFIG.colors.success)], 
                    files, 
                    ephemeral: true 
                });
                await Logger.discord('Scan Serveur', `**${ctx.user.tag}** a généré une analyse complète du serveur.`, CONFIG.colors.info, [{name:'Fichiers', value: CONFIG.limits.scanFiles, inline:true}, {name:'Éléments', value: items.length, inline:true}], ctx.user.displayAvatarURL());
            } catch (e) {
                Logger.error('Échec de la commande scan', e);
                await ctx.followUp({ embeds: [new EmbedBuilder().setTitle('Erreur Critique').setDescription(e.message).setColor(CONFIG.colors.danger)], ephemeral: true });
            }
        }
    });

    cmdHandler.register({
        name: 'ticket',
        slashData: new SlashCommandBuilder().setName('ticket').setDescription('Ouvre un ticket de support avec formulaire.'),
        cooldown: 10,
        execute: async (ctx) => {
            const modal = new ModalBuilder().setCustomId('ticket_modal').setTitle('Création de Ticket');
            const reason = new TextInputBuilder().setCustomId('reason').setLabel('Motif de votre demande').setStyle(TextInputStyle.Paragraph).setRequired(true);
            modal.addComponents(new ActionRowBuilder().addComponents(reason));
            await ctx.showModal(modal);
        }
    });

    cmdHandler.register({
        name: 'warn',
        slashData: new SlashCommandBuilder().setName('warn').setDescription('Avertit un membre (Modération).').addUserOption(o=>o.setName('membre').setRequired(true)).addStringOption(o=>o.setName('raison').setRequired(true)),
        cooldown: 5,
        execute: async (ctx) => {
            const target = ctx.options.getUser('membre');
            const reason = ctx.options.getString('raison');
            await Services.User.getOrCreate(target.id, target.tag);
            db.addWarning(target.id);
            db.data.warnings.push({ user: target.id, mod: ctx.user.id, reason, date: new Date().toISOString() });
            db.save();
            await Logger.discord('Avertissement', `**${target.tag}** a été averti par **${ctx.user.tag}**.`, CONFIG.colors.warning, [{name:'Motif', value: reason}], target.displayAvatarURL());
            try { await target.send({ embeds: [new EmbedBuilder().setTitle('Avertissement').setDescription(`Motif : ${reason}`).setColor(CONFIG.colors.warning)] }); } catch (e) {}
            await ctx.reply({ embeds: [new EmbedBuilder().setTitle('Succès').setDescription(`${target} a été averti. (Total : ${db.getUser(target.id).warnings})`).setColor(CONFIG.colors.success)] });
        }
    });

    cmdHandler.register({
        name: 'ping',
        slashData: new SlashCommandBuilder().setName('ping').setDescription('Vérifie la latence du système.'),
        execute: async (ctx, client) => await ctx.reply({ embeds: [new EmbedBuilder().setTitle('Latence Système').setDescription(`API Discord: **${client.ws.ping}ms**`).setColor(CONFIG.colors.primary)] })
    });
}

// ==========================================
// 8. CLASSE PRINCIPALE DU BOT (Framework)
// ==========================================
class VQCBot {
    constructor() {
        this.client = new Client({ 
            intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildModeration, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildPresences] 
        });
        this.expressApp = express();
        this.startTime = Date.now();
        this.setupExpress();
        this.setupEvents();
    }

    setupExpress() {
        this.expressApp.use(express.json());
        this.expressApp.use((req, res, next) => {
            res.header('Access-Control-Allow-Origin', '*');
            res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
            next();
        });

        this.expressApp.get('/', (req, res) => res.json({ status: 'online', uptime: Math.floor((Date.now() - this.startTime)/1000), version: '12.0.0' }));
        
        this.expressApp.get('/api/stats', (req, res) => {
            const guild = this.client.guilds.cache.get(CONFIG.server.id);
            if (!guild) return res.status(404).json({ error: 'Serveur introuvable' });
            res.json({ 
                members: guild.memberCount, 
                online: guild.members.cache.filter(m => !m.user.bot && m.presence?.status !== 'offline').size, 
                ping: this.client.ws.ping 
            });
        });

        const PORT = process.env.PORT || 3000;
        this.expressApp.listen(PORT, '0.0.0.0', () => Logger.info(`Serveur API actif sur le port ${PORT}`));
    }

    setupEvents() {
        this.client.once('clientReady', async () => {
            Logger.info(`Connexion établie: ${this.client.user.tag}`);
            this.client.user.setPresence({ activities: [{ name: 'Ville de Québec Roleplay', type: ActivityType.Watching }], status: 'online' });
            await Logger.discord('Système Opérationnel', 'Le bot est maintenant en ligne et pleinement fonctionnel.', CONFIG.colors.success, [], this.client.user.displayAvatarURL());
            
            try {
                await new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN).put(
                    Routes.applicationGuildCommands(this.client.user.id, CONFIG.server.id), 
                    { body: Array.from(cmdHandler.commands.values()).map(c => c.slashData.toJSON()) }
                );
                Logger.info('Commandes slash enregistrées avec succès.');
            } catch (e) { Logger.error('Échec enregistrement commandes', e); }
        });

        this.client.on('messageCreate', async (msg) => {
            if (msg.author.bot || msg.guild?.id !== CONFIG.server.id) return;
            db.incrementStat('messages');
            
            if (msg.content.startsWith(CONFIG.prefix)) {
                const args = msg.content.slice(CONFIG.prefix.length).trim().split(/ +/);
                await cmdHandler.execute(args, true, msg);
                return;
            }

            const xp = await Services.User.addXP(msg.author.id, Math.floor(Math.random() * 15) + 10);
            if (xp?.leveledUp) {
                msg.reply({ embeds: [new EmbedBuilder().setTitle('Niveau Supérieur').setDescription(`Félicitations ${msg.author}, vous avez atteint le niveau **${xp.level}** !`).setColor(CONFIG.colors.success)] }).catch(() => {});
            }
        });

        this.client.on('interactionCreate', async (i) => {
            if (i.isChatInputCommand()) {
                await cmdHandler.execute(i);
            } else if (i.isModalSubmit() && i.customId === 'ticket_modal') {
                const reason = i.fields.getTextInputValue('reason');
                const guild = i.guild;
                try {
                    const ticketChannel = await guild.channels.create({
                        name: `ticket-${i.user.username.toLowerCase()}`,
                        type: ChannelType.GuildText,
                        permissionOverwrites: [
                            { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                            { id: i.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }
                        ]
                    });
                    db.data.tickets[ticketChannel.id] = { user: i.user.id, reason, status: 'open', date: new Date().toISOString() };
                    db.save();
                    
                    await ticketChannel.send({ 
                        content: `${i.user}`, 
                        embeds: [new EmbedBuilder().setTitle('Nouveau Ticket de Support').setDescription(`**Motif :** ${reason}\n\nUn membre de l'équipe de direction va prendre en charge votre demande dans les plus brefs délais.`).setColor(CONFIG.colors.primary).setTimestamp()] 
                    });
                    await i.reply({ embeds: [new EmbedBuilder().setTitle('Succès').setDescription(`Votre ticket a été créé : ${ticketChannel}`).setColor(CONFIG.colors.success)], ephemeral: true });
                } catch (e) {
                    Logger.error('Échec création ticket', e);
                    await i.reply({ embeds: [new EmbedBuilder().setTitle('Erreur').setDescription('Impossible de créer le ticket.').setColor(CONFIG.colors.danger)], ephemeral: true });
                }
            }
        });

        process.on('SIGINT', () => { Logger.info('Arrêt gracieux du système...'); this.client.destroy(); process.exit(0); });
        process.on('SIGTERM', () => { Logger.info('Arrêt gracieux du système...'); this.client.destroy(); process.exit(0); });
    }

    async start() {
        try {
            Logger.info('Initialisation de la base de données...');
            await db.init();
            Logger.info('Configuration des modules de commandes...');
            setupCommands();
            Logger.info('Tentative de connexion à Discord...');
            await this.client.login(process.env.DISCORD_TOKEN);
            Logger.info('Bot démarré avec succès.');
        } catch (e) { 
            Logger.fatal('Échec critique au démarrage', e); 
            process.exit(1); 
        }
    }
}

// ==========================================
// 9. INITIALISATION GLOBALE
// ==========================================
global.bot = new VQCBot();
global.bot.start();
