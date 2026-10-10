/**
 * @fileoverview VQC Discord Bot - Ultimate Enterprise Framework
 * @version 14.0.0 (Production Hardened - Auto-Sync Enabled)
 * @author Jacobin Babouain
 * @license MIT
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
// 1. CONFIGURATION & CONSTANTES
// ==========================================
const CONFIG = Object.freeze({
    prefix: process.env.BOT_PREFIX || '.',
    server: {
        id: process.env.GUILD_ID || '1490410149213507804',
        name: 'Ville de Québec Roleplay',
        icon: 'https://cdn.discordapp.com/icons/1490410149213507804/0b1aa46a2fdb33b133a0feb1234739f6.webp?size=1024'
    },
    channels: { 
        logs: process.env.LOG_CHANNEL_ID || '1538659168012075029',
        sync: ['règles-du-jeu', 'annonces', 'sessions', 'médias-officiels', 'partenariat']
    },
    colors: { primary: 0x003DA5, success: 0x10b981, warning: 0xf59e0b, danger: 0xef4444, info: 0x06b6d4 },
    limits: { xpCooldown: 60000, dailyCooldown: 86400000, commandCooldown: 5 }
});

// ==========================================
// 2. BASE DE DONNÉES ATOMIQUE & SYNCHRONISATION
// ==========================================
class AtomicDatabase {
    constructor(filePath) {
        this.filePath = filePath;
        this.data = this.getDefaultStructure();
        this.saveQueue = [];
        this.isSaving = false;
    }

    getDefaultStructure() {
        return {
            users: {}, warnings: [], tickets: {}, commands: {}, tags: {}, stats: { messages: 0, commands: 0, members: 0 },
            server_info: { regles: [], annonces: [], sessions: [], medias: [], last_sync: null }
        };
    }

    async init() {
        try {
            const content = await fs.readFile(this.filePath, 'utf8');
            this.data = { ...this.data, ...JSON.parse(content) };
            this._validateSchema();
            console.log('[INFO] Base de données chargée et validée.');
        } catch (err) {
            if (err.code === 'ENOENT') { 
                await this.save(); 
                console.log('[WARN] Nouvelle base de données initialisée.'); 
            } else { 
                console.error('[FATAL] Corruption de la base de données', err); 
                throw err; 
            }
        }
    }

    _validateSchema() {
        const required = { users: {}, warnings: [], tickets: {}, commands: {}, tags: {}, stats: { messages: 0, commands: 0, members: 0 }, server_info: { regles: [], annonces: [], sessions: [], medias: [], last_sync: null } };
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
            await fs.rename(tempPath, this.filePath);
        } catch (err) { console.error('[ERROR] Échec sauvegarde BDD', err); }
        finally {
            this.isSaving = false;
            if (this.saveQueue.length > 0) this.saveQueue.shift()();
        }
    }

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
    getTopUsers(limit = 10) { return Object.values(this.data.users).sort((a, b) => (b.total_xp || 0) - (a.total_xp || 0)).slice(0, limit); }
    incrementStat(stat) { if (this.data.stats[stat] !== undefined) { this.data.stats[stat]++; this.save(); } }

    async syncChannelInfo(channel, type) {
        try {
            const messages = await channel.messages.fetch({ limit: 20 });
            this.data.server_info[type] = messages.map(msg => ({
                id: msg.id, author: msg.author.username, content: msg.content,
                timestamp: msg.createdAt.toISOString(), attachments: msg.attachments.map(att => att.url)
            }));
            this.data.server_info.last_sync = new Date().toISOString();
            await this.save();
            console.log(`[INFO] Synchronisation réussie : ${type}`);
        } catch (error) { console.error(`[ERROR] Erreur de synchronisation ${type}`, error); }
    }

    async autoSyncImportantChannels(client) {
        const guild = client.guilds.cache.get(CONFIG.server.id);
        if (!guild) return;
        for (const channelName of CONFIG.channels.sync) {
            const channel = guild.channels.cache.find(c => c.name.toLowerCase().includes(channelName.toLowerCase()));
            if (channel && channel.isTextBased()) {
                const typeMap = { 'règles-du-jeu': 'regles', 'annonces': 'annonces', 'sessions': 'sessions', 'médias-officiels': 'medias' };
                const type = Object.keys(typeMap).find(key => channelName.toLowerCase().includes(key)) || 'other';
                await this.syncChannelInfo(channel, type);
            }
        }
    }
}

const db = new AtomicDatabase(path.join(__dirname, 'vqc_data.json'));

// ==========================================
// 3. GESTIONNAIRE DE COMMANDES
// ==========================================
class CommandHandler {
    constructor() { this.commands = new Collection(); this.cooldowns = new Collection(); }
    register(cmd) { this.commands.set(cmd.name, cmd); }

    async execute(interaction, isPrefix = false, message = null) {
        const cmdName = isPrefix ? interaction[0].toLowerCase() : interaction.commandName;
        const command = this.commands.get(cmdName);
        if (!command) return;

        if (command.cooldown) {
            if (!this.cooldowns.has(command.name)) this.cooldowns.set(command.name, new Collection());
            const now = Date.now();
            const timestamps = this.cooldowns.get(command.name);
            const cooldown = (command.cooldown || CONFIG.limits.commandCooldown) * 1000;
            const userId = interaction.user?.id || interaction.author.id;

            if (timestamps.has(userId)) {
                const exp = timestamps.get(userId) + cooldown;
                if (now < exp) {
                    const reply = isPrefix ? await message.channel.send(`Veuillez patienter **${((exp - now) / 1000).toFixed(1)}s**.`) : await interaction.reply({ embeds: [new EmbedBuilder().setTitle('Cooldown Actif').setDescription(`Veuillez patienter **${((exp - now) / 1000).toFixed(1)} secondes**.`).setColor(CONFIG.colors.warning)], ephemeral: true });
                    return;
                }
            }
            timestamps.set(userId, now);
            setTimeout(() => timestamps.delete(userId), cooldown);
        }

        try {
            await command.execute(interaction, global.bot.client, db, isPrefix, message);
            db.incrementStat('commands');
        } catch (err) {
            console.error(`[ERROR] Erreur commande: ${cmdName}`, err);
            const errEmbed = new EmbedBuilder().setTitle('Erreur Système').setDescription('Une erreur inattendue s\'est produite.').setColor(CONFIG.colors.danger);
            if (isPrefix) await message.channel.send({ embeds: [errEmbed] });
            else await (interaction.replied || interaction.deferred ? interaction.followUp({ embeds: [errEmbed], ephemeral: true }) : interaction.reply({ embeds: [errEmbed], ephemeral: true }));
        }
    }
}

const cmdHandler = new CommandHandler();

// ==========================================
// 4. SERVICES MÉTIER
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
    Economy: {
        async claimDaily(userId) {
            const user = db.getUser(userId);
            if (!user) return { success: false, error: 'Utilisateur introuvable.' };
            const now = Date.now();
            if (user.last_daily && now - user.last_daily < CONFIG.limits.dailyCooldown) {
                return { success: false, remaining: CONFIG.limits.dailyCooldown - (now - user.last_daily) };
            }
            const reward = Math.floor(Math.random() * 100) + 50;
            db.updateCoins(userId, user.coins + reward);
            db.data.users[userId].last_daily = now;
            db.save();
            return { success: true, reward };
        }
    }
};

// ==========================================
// 5. ENREGISTREMENT DES COMMANDES
// ==========================================
function setupCommands() {
    cmdHandler.register({
        name: 'ping',
        slashData: new SlashCommandBuilder().setName('ping').setDescription('Vérifie la latence du système.'),
        execute: async (ctx, client) => await ctx.reply({ embeds: [new EmbedBuilder().setTitle('Latence Système').setDescription(`API Discord: **${client.ws.ping}ms**`).setColor(CONFIG.colors.primary)] })
    });

    cmdHandler.register({
        name: 'rank',
        slashData: new SlashCommandBuilder().setName('rank').setDescription('Affiche votre rang et votre expérience.').addUserOption(o => o.setName('utilisateur').setDescription('L\'utilisateur à consulter')),
        execute: async (ctx) => {
            const target = ctx.options.getUser('utilisateur') || ctx.user;
            const user = await Services.User.getOrCreate(target.id, target.tag);
            const xpNeeded = user.level * 100 + (user.level - 1) * 50;
            await ctx.reply({ embeds: [new EmbedBuilder().setTitle(`Rang de ${target.username}`).setDescription(`**Niveau :** ${user.level}\n**XP :** ${user.xp}/${xpNeeded}\n**XP Total :** ${user.total_xp}`).setColor(CONFIG.colors.primary).setThumbnail(target.displayAvatarURL())] });
        }
    });

    cmdHandler.register({
        name: 'balance',
        slashData: new SlashCommandBuilder().setName('balance').setDescription('Affiche votre solde.').addUserOption(o => o.setName('utilisateur').setDescription('L\'utilisateur à consulter')),
        execute: async (ctx) => {
            const target = ctx.options.getUser('utilisateur') || ctx.user;
            const user = await Services.User.getOrCreate(target.id, target.tag);
            await ctx.reply({ embeds: [new EmbedBuilder().setTitle(`Solde de ${target.username}`).setDescription(`**Pièces :** ${user.coins}\n**Banque :** ${user.bank}\n**Total :** ${user.coins + user.bank}`).setColor(CONFIG.colors.primary).setThumbnail(target.displayAvatarURL())] });
        }
    });

    cmdHandler.register({
        name: 'daily',
        slashData: new SlashCommandBuilder().setName('daily').setDescription('Réclame ta récompense quotidienne.'),
        cooldown: 10,
        execute: async (ctx) => {
            const result = await Services.Economy.claimDaily(ctx.user.id);
            if (!result.success) return ctx.reply({ embeds: [new EmbedBuilder().setTitle('Cooldown').setDescription(`Reviens dans **${Math.ceil(result.remaining / 3600000)} heure(s)**.`).setColor(CONFIG.colors.warning)] });
            await ctx.reply({ embeds: [new EmbedBuilder().setTitle('Récompense Quotidienne').setDescription(`Tu as reçu **${result.reward} pièces** !`).setColor(CONFIG.colors.success)] });
        }
    });

    cmdHandler.register({
        name: 'warn',
        slashData: new SlashCommandBuilder().setName('warn').setDescription('Avertit un membre.').setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers).addUserOption(o => o.setName('membre').setDescription('Le membre').setRequired(true)).addStringOption(o => o.setName('raison').setDescription('Motif').setRequired(true)),
        permissions: [PermissionFlagsBits.ModerateMembers],
        execute: async (ctx) => {
            const target = ctx.options.getUser('membre');
            const reason = ctx.options.getString('raison');
            await Services.User.getOrCreate(target.id, target.tag);
            db.addWarning(target.id);
            db.data.warnings.push({ user: target.id, mod: ctx.user.id, reason, date: new Date().toISOString() });
            db.save();
            await ctx.reply({ embeds: [new EmbedBuilder().setTitle('Avertissement Enregistré').setDescription(`${target.tag} a été averti. (Total : ${db.getUser(target.id).warnings})`).setColor(CONFIG.colors.success)] });
        }
    });

    cmdHandler.register({
        name: 'sync-info',
        slashData: new SlashCommandBuilder().setName('sync-info').setDescription('Force la synchronisation des salons importants (Admin seulement).').setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        permissions: [PermissionFlagsBits.Administrator],
        execute: async (ctx) => {
            await ctx.reply({ content: 'Synchronisation des informations du serveur en cours...', ephemeral: true });
            await db.autoSyncImportantChannels(ctx.client);
            await ctx.followUp({ content: 'Synchronisation terminée avec succès ! Le site web est maintenant à jour.', ephemeral: true });
        }
    });
}

// ==========================================
// 6. CLASSE PRINCIPALE DU BOT
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
        this.expressApp.use((req, res, next) => {
            res.header('Access-Control-Allow-Origin', '*');
            res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
            next();
        });

        this.expressApp.get('/', (req, res) => res.json({ status: 'online', uptime: Math.floor((Date.now() - this.startTime) / 1000), version: '14.0.0' }));
        
        this.expressApp.get('/api/stats', (req, res) => {
            const guild = this.client.guilds.cache.get(CONFIG.server.id);
            if (!guild) return res.status(404).json({ error: 'Serveur introuvable' });
            res.json({ members: guild.memberCount, online: guild.members.cache.filter(m => !m.user.bot && m.presence?.status !== 'offline').size, ping: this.client.ws.ping });
        });

        // NOUVEAU : API pour le site web
        this.expressApp.get('/api/v1/server-data', (req, res) => {
            res.json({ success: true, last_sync: db.data.server_info.last_sync, data: db.data.server_info });
        });

        const PORT = process.env.PORT || 3000;
        this.expressApp.listen(PORT, '0.0.0.0', () => console.log(`[INFO] Serveur API actif sur le port ${PORT}`));
    }

    setupEvents() {
        this.client.once('clientReady', async () => {
            console.log(`[INFO] Connecté en tant que ${this.client.user.tag}`);
            this.client.user.setPresence({ activities: [{ name: 'Ville de Québec Roleplay', type: ActivityType.Watching }], status: 'online' });
            
            try {
                await new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN).put(Routes.applicationGuildCommands(this.client.user.id, CONFIG.server.id), { body: Array.from(cmdHandler.commands.values()).map(c => c.slashData.toJSON()) });
                console.log('[INFO] Commandes slash enregistrées.');
                // Synchronisation initiale au démarrage
                await db.autoSyncImportantChannels(this.client);
            } catch (error) { console.error('[ERROR] Échec enregistrement commandes', error); }
        });

        this.client.on('messageCreate', async (message) => {
            if (message.author.bot || message.guild?.id !== CONFIG.server.id) return;
            db.incrementStat('messages');
            
            if (message.content.startsWith(CONFIG.prefix)) {
                const args = message.content.slice(CONFIG.prefix.length).trim().split(/ +/);
                await cmdHandler.execute(args, true, message);
                return;
            }

            // Synchronisation automatique en temps réel des salons importants
            const channelName = message.channel.name.toLowerCase();
            if (CONFIG.channels.sync.some(name => channelName.includes(name))) {
                const typeMap = { 'règles-du-jeu': 'regles', 'annonces': 'annonces', 'sessions': 'sessions', 'médias-officiels': 'medias' };
                const type = Object.keys(typeMap).find(key => channelName.includes(key)) || 'other';
                
                const newEntry = { id: message.id, author: message.author.username, content: message.content, timestamp: message.createdAt.toISOString(), attachments: message.attachments.map(att => att.url) };
                db.data.server_info[type].unshift(newEntry);
                if (db.data.server_info[type].length > 30) db.data.server_info[type].pop();
                db.data.server_info.last_sync = new Date().toISOString();
                db.save();
            }

            const xp = await Services.User.addXP(message.author.id, Math.floor(Math.random() * 15) + 10);
            if (xp?.leveledUp) {
                message.reply({ embeds: [new EmbedBuilder().setTitle('Niveau Supérieur').setDescription(`Félicitations ${message.author}, vous avez atteint le niveau **${xp.level}** !`).setColor(CONFIG.colors.success)] }).catch(() => {});
            }
        });

        this.client.on('interactionCreate', async (interaction) => {
            if (interaction.isChatInputCommand()) await cmdHandler.execute(interaction);
        });

        process.on('SIGINT', () => { console.log('[INFO] Arrêt gracieux...'); this.client.destroy(); process.exit(0); });
        process.on('SIGTERM', () => { console.log('[INFO] Arrêt gracieux...'); this.client.destroy(); process.exit(0); });
    }

    async start() {
        try {
            console.log('[INFO] Initialisation de la base de données...');
            await db.init();
            console.log('[INFO] Configuration des modules de commandes...');
            setupCommands();
            console.log('[INFO] Tentative de connexion à Discord...');
            await this.client.login(process.env.DISCORD_TOKEN);
            console.log('[INFO] Bot démarré avec succès.');
        } catch (error) { 
            console.error('[FATAL] Échec critique au démarrage', error); 
            process.exit(1); 
        }
    }
}

global.bot = new VQCBot();
global.bot.start();
