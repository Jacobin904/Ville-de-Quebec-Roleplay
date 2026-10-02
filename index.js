/**
 * VQC Discord Bot - Ultimate Enterprise Edition
 * Architecture: Modular Monolith with Atomic Operations
 * Version: 9.0.0 (Production Hardened)
 */

'use strict';

require('dotenv').config();
const fs = require('fs').promises;
const path = require('path');
const express = require('express');
const { 
    Client, GatewayIntentBits, EmbedBuilder, SlashCommandBuilder, 
    REST, Routes, ChannelType, PermissionFlagsBits, Collection, ActivityType
} = require('discord.js');

// ==========================================
// 1. CONFIGURATION IMMUTABLE
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
// 2. SYSTÈME DE JOURNALISATION & CACHE
// ==========================================
class Logger {
    static info(msg) { console.log(`[${new Date().toISOString()}] [INFO] ${msg}`); }
    static warn(msg) { console.warn(`[${new Date().toISOString()}] [WARN] ${msg}`); }
    static error(msg, err = null) { console.error(`[${new Date().toISOString()}] [ERROR] ${msg}`, err ? err.stack : ''); }
    static success(msg) { console.log(`[${new Date().toISOString()}] [SUCCESS] ${msg}`); }

    static async discord(title, desc, color = CONFIG.colors.primary, fields = [], thumb = null) {
        try {
            const embed = new EmbedBuilder().setTitle(title).setDescription(desc).setColor(color).setFooter({ text: CONFIG.server.name, iconURL: CONFIG.server.icon }).setTimestamp();
            if (fields?.length) embed.addFields(fields);
            if (thumb) embed.setThumbnail(thumb);
            const channel = bot?.client?.channels?.cache?.get(CONFIG.channels.logs);
            if (channel) await channel.send({ embeds: [embed] }).catch(() => {});
        } catch (err) { Logger.error('Échec journal Discord', err); }
    }
}

class Cache {
    constructor(ttl = 60000) { this.store = new Map(); this.ttl = ttl; }
    get(key) { const item = this.store.get(key); if (!item || Date.now() > item.expiry) { this.store.delete(key); return null; } return item.value; }
    set(key, value) { this.store.set(key, { value, expiry: Date.now() + this.ttl }); }
}
const cache = new Cache();

// ==========================================
// 3. BASE DE DONNÉES ATOMIQUE (Anti-Corruption)
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
            Logger.success('Base de données chargée et validée.');
        } catch (err) {
            if (err.code === 'ENOENT') { await this.save(); Logger.warn('Nouvelle base de données créée.'); }
            else { Logger.error('Corruption de la base de données', err); throw err; }
        }
    }

    async save() {
        if (this.isSaving) { this.saveQueue.push(() => this.save()); return; }
        this.isSaving = true;
        try {
            const tempPath = `${this.filePath}.tmp`;
            await fs.writeFile(tempPath, JSON.stringify(this.data, null, 2), 'utf8');
            await fs.rename(tempPath, this.filePath); // Opération atomique
        } catch (err) { Logger.error('Échec sauvegarde BDD', err); }
        finally {
            this.isSaving = false;
            if (this.saveQueue.length > 0) this.saveQueue.shift()();
        }
    }

    // Helpers
    getUser(id) { return this.data.users[id] || null; }
    createUser(id, username) {
        this.data.users[id] = { id, username, level: 1, xp: 0, total_xp: 0, coins: 100, warnings: 0, last_xp: 0, last_daily: 0 };
        this.save();
    }
    updateXP(id, xp, total_xp, level, last_xp) {
        if (this.data.users[id]) { Object.assign(this.data.users[id], { xp, total_xp, level, last_xp }); this.save(); }
    }
    updateCoins(id, amount) { if (this.data.users[id]) { this.data.users[id].coins = amount; this.save(); } }
    addWarning(id) { if (this.data.users[id]) { this.data.users[id].warnings++; this.save(); } }
    getTopUsers(limit = 10) { return Object.values(this.data.users).sort((a, b) => b.total_xp - a.total_xp).slice(0, limit); }
}

const db = new AtomicDatabase(path.join(__dirname, 'vqc_data.json'));

// ==========================================
// 4. REGISTRE DE COMMANDES AVANCÉ
// ==========================================
class CommandRegistry {
    constructor() { this.commands = new Collection(); this.cooldowns = new Collection(); }

    register(cmd) { this.commands.set(cmd.name, cmd); }

    async execute(interaction, isPrefix = false, message = null) {
        const cmdName = isPrefix ? interaction[0].toLowerCase() : interaction.commandName;
        const command = this.commands.get(cmdName);
        if (!command) return;

        // Rate Limiting
        if (command.cooldown) {
            if (!this.cooldowns.has(command.name)) this.cooldowns.set(command.name, new Collection());
            const now = Date.now();
            const timestamps = this.cooldowns.get(command.name);
            const cooldown = (command.cooldown || CONFIG.limits.commandCooldown) * 1000;
            if (timestamps.has(interaction.user?.id || interaction.author.id)) {
                const exp = timestamps.get(interaction.user?.id || interaction.author.id) + cooldown;
                if (now < exp) {
                    const reply = isPrefix ? await message.channel.send(`Cooldown: ${(exp - now)/1000}s`) : await interaction.reply({ embeds: [new EmbedBuilder().setTitle('Cooldown').setDescription(`Attendez **${((exp - now)/1000).toFixed(1)}s**`).setColor(CONFIG.colors.warning)], ephemeral: true });
                    return;
                }
            }
            timestamps.set(interaction.user?.id || interaction.author.id, now);
            setTimeout(() => timestamps.delete(interaction.user?.id || interaction.author.id), cooldown);
        }

        try {
            await command.execute(interaction, bot.client, db, isPrefix, message);
            db.data.stats.commands++;
            db.save();
        } catch (err) {
            Logger.error(`Erreur commande ${cmdName}`, err);
            const errEmbed = new EmbedBuilder().setTitle('Erreur Critique').setDescription('Une erreur interne est survenue.').setColor(CONFIG.colors.danger);
            if (isPrefix) await message.channel.send({ embeds: [errEmbed] });
            else await (interaction.replied || interaction.deferred ? interaction.followUp({ embeds: [errEmbed], ephemeral: true }) : interaction.reply({ embeds: [errEmbed], ephemeral: true }));
        }
    }
}
const registry = new CommandRegistry();

// ==========================================
// 5. SERVICES MÉTIER
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
                for (const rId of Object.values(dept.roles)) if (target.roles.cache.has(rId)) await target.roles.remove(rId);
                await target.roles.add(roleId);
                return { ok: true, grade: gradeKey, dept: dept.name };
            } catch (e) { return { ok: false, msg: e.message }; }
        }
    }
};

// ==========================================
// 6. DÉFINITION DES COMMANDES
// ==========================================
function setupCommands() {
    registry.register({
        name: 'promote',
        slashData: new SlashCommandBuilder().setName('promote').setDescription('Promouvoir un membre (Directeurs uniquement).').addUserOption(o => o.setName('utilisateur').setRequired(true)).addStringOption(o => o.setName('département').setRequired(true).addChoices({name:'SPVQ',value:'spvq'},{name:'SPCIQ',value:'spciq'},{name:'SQ',value:'sq'})).addStringOption(o => o.setName('grade').setRequired(true)),
        cooldown: 5,
        execute: async (ctx, client) => {
            const target = ctx.options.getMember('utilisateur');
            const deptKey = ctx.options.getString('département');
            const grade = ctx.options.getString('grade');
            if (!Services.Department.isDirector(ctx.member, deptKey)) return ctx.reply({ embeds: [new EmbedBuilder().setTitle('Accès Refusé').setDescription('Seul le directeur de ce département peut effectuer cette action.').setColor(CONFIG.colors.danger)], ephemeral: true });
            
            const result = await Services.Department.promote(target, deptKey, grade);
            if (!result.ok) return ctx.reply({ embeds: [new EmbedBuilder().setTitle('Erreur').setDescription(result.msg).setColor(CONFIG.colors.danger)], ephemeral: true });
            
            await Logger.discord('Promotion', `**${target.user.tag}** promu **${result.grade}** en **${result.dept}**.`, CONFIG.colors.success, [{name:'Par', value: ctx.user.tag}], target.user.displayAvatarURL());
            await ctx.reply({ embeds: [new EmbedBuilder().setTitle('Succès').setDescription(`${target} est maintenant **${result.grade}**.`).setColor(CONFIG.colors.success)] });
        }
    });

    registry.register({
        name: 'scan',
        slashData: new SlashCommandBuilder().setName('scan').setDescription('Analyse complète du serveur (10 fichiers JSON équilibrés).'),
        cooldown: 120,
        execute: async (ctx) => {
            await ctx.deferReply({ ephemeral: true });
            try {
                const guild = ctx.guild;
                const items = [];
                items.push({ type: 'info', id: guild.id, name: guild.name, members: guild.memberCount });
                guild.channels.cache.forEach(c => items.push({ type: 'channel', id: c.id, name: c.name, type: ChannelType[c.type] }));
                guild.roles.cache.forEach(r => items.push({ type: 'role', id: r.id, name: r.name, color: r.hexColor }));
                guild.members.cache.forEach(m => items.push({ type: 'member', id: m.id, name: m.user.username, display: m.displayName }));

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
                const safeName = guild.name.replace(/\s+/g, '_');
                for (let i = 0; i < CONFIG.limits.scanFiles; i++) {
                    const meta = { _meta: { file: i+1, total: CONFIG.limits.scanFiles, server: guild.name, items: buckets[i].items.length, size_kb: Math.round(buckets[i].size/1024) }, data: buckets[i].items };
                    files.push({ attachment: Buffer.from(JSON.stringify(meta, null, 2), 'utf-8'), name: `scan_${safeName}_part${String(i+1).padStart(2,'0')}_${ts}.json` });
                }

                await ctx.followUp({ embeds: [new EmbedBuilder().setTitle('Analyse Terminée').setDescription(`Génération de **${CONFIG.limits.scanFiles} fichiers** réussie.`).setColor(CONFIG.colors.success)], files, ephemeral: true });
                await Logger.discord('Scan Serveur', `**${ctx.user.tag}** a analysé le serveur.`, CONFIG.colors.info, [{name:'Fichiers', value: CONFIG.limits.scanFiles, inline:true}, {name:'Éléments', value: items.length, inline:true}], ctx.user.displayAvatarURL());
            } catch (e) {
                await ctx.followUp({ embeds: [new EmbedBuilder().setTitle('Erreur').setDescription(e.message).setColor(CONFIG.colors.danger)], ephemeral: true });
            }
        }
    });

    // Commandes supplémentaires essentielles (Ping, Warn, Daily, etc.)
    registry.register({
        name: 'ping',
        slashData: new SlashCommandBuilder().setName('ping').setDescription('Vérifie la latence.'),
        execute: async (ctx, client) => await ctx.reply({ embeds: [new EmbedBuilder().setTitle('Latence').setDescription(`API: **${client.ws.ping}ms**`).setColor(CONFIG.colors.primary)] })
    });
    
    registry.register({
        name: 'warn',
        slashData: new SlashCommandBuilder().setName('warn').setDescription('Avertit un membre.').addUserOption(o=>o.setName('membre').setRequired(true)).addStringOption(o=>o.setName('raison').setRequired(true)),
        execute: async (ctx) => {
            const target = ctx.options.getUser('membre');
            const reason = ctx.options.getString('raison');
            await Services.User.getOrCreate(target.id, target.tag);
            db.addWarning(target.id);
            db.data.warnings.push({ user: target.id, mod: ctx.user.id, reason, date: new Date().toISOString() });
            db.save();
            await Logger.discord('Avertissement', `**${target.tag}** averti par **${ctx.user.tag}**.`, CONFIG.colors.warning, [{name:'Raison', value: reason}], target.displayAvatarURL());
            await ctx.reply({ embeds: [new EmbedBuilder().setTitle('Succès').setDescription(`${target} a été averti.`).setColor(CONFIG.colors.success)] });
        }
    });
}

// ==========================================
// 7. CLASSE PRINCIPALE DU BOT
// ==========================================
class VQCBot {
    constructor() {
        this.client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildModeration, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildPresences] });
        this.expressApp = express();
        this.startTime = Date.now();
        this.setupExpress();
        this.setupEvents();
    }

    setupExpress() {
        this.expressApp.use(express.json());
        this.expressApp.get('/', (req, res) => res.json({ status: 'online', uptime: Math.floor((Date.now() - this.startTime)/1000), version: '9.0.0' }));
        this.expressApp.get('/api/stats', (req, res) => {
            const guild = this.client.guilds.cache.get(CONFIG.server.id);
            if (!guild) return res.status(404).json({ error: 'Introuvable' });
            res.json({ members: guild.memberCount, online: guild.members.cache.filter(m => !m.user.bot && m.presence?.status !== 'offline').size, ping: this.client.ws.ping });
        });
        this.expressApp.listen(process.env.PORT || 3000, '0.0.0.0', () => Logger.success(`API active sur le port ${process.env.PORT || 3000}`));
    }

    setupEvents() {
        this.client.once('clientReady', async () => {
            Logger.success(`Connecté: ${this.client.user.tag}`);
            this.client.user.setPresence({ activities: [{ name: 'Ville de Québec Roleplay', type: ActivityType.Watching }], status: 'online' });
            await Logger.discord('Démarrage', 'Système opérationnel.', CONFIG.colors.success, [], this.client.user.displayAvatarURL());
            try {
                await new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN).put(Routes.applicationGuildCommands(this.client.user.id, CONFIG.server.id), { body: Array.from(registry.commands.values()).map(c => c.slashData.toJSON()) });
                Logger.success('Commandes enregistrées.');
            } catch (e) { Logger.error('Échec commandes', e); }
        });

        this.client.on('messageCreate', async (msg) => {
            if (msg.author.bot || msg.guild?.id !== CONFIG.server.id) return;
            db.data.stats.messages++;
            
            if (msg.content.startsWith(CONFIG.prefix)) {
                const args = msg.content.slice(CONFIG.prefix.length).trim().split(/ +/);
                await registry.execute(args, true, msg);
                return;
            }

            const xp = await Services.User.addXP(msg.author.id, Math.floor(Math.random() * 15) + 10);
            if (xp?.leveledUp) msg.reply({ embeds: [new EmbedBuilder().setTitle('Niveau Supérieur').setDescription(`Félicitations ${msg.author}, niveau **${xp.level}** !`).setColor(CONFIG.colors.success)] }).catch(() => {});
        });

        this.client.on('interactionCreate', async (i) => {
            if (i.isChatInputCommand()) await registry.execute(i);
        });

        process.on('SIGINT', () => { Logger.info('Arrêt...'); this.client.destroy(); process.exit(0); });
    }

    async start() {
        try {
            await db.init();
            setupCommands();
            await this.client.login(process.env.DISCORD_TOKEN);
            Logger.success('Bot démarré avec succès.');
        } catch (e) { Logger.fatal('Échec critique', e); process.exit(1); }
    }
}

const bot = new VQCBot();
bot.start();
