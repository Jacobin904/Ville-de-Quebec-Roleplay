/**
 * @fileoverview VQC Discord Bot - Ultimate Enterprise Framework
 * @version 13.0.0 (Production Hardened - Full Featured)
 * @author Jacobin Babouain
 * @license MIT
 * 
 * @description
 * Architecture modulaire avancée incluant :
 * - Gestionnaire de commandes avec middleware (permissions, cooldowns, validation)
 * - Base de données JSON avec écriture atomique (anti-corruption)
 * - Système de cache LRU pour les performances optimales
 * - Journalisation structurée et gestion d'erreurs globale
 * - Services métier isolés (User, Economy, Moderation, Department, Ticket, Reminder)
 * - Système de niveaux et d'économie complet
 * - Gestion des giveaways et rappels automatiques
 * - API REST complète pour le site web
 * - Système de tags et commandes personnalisées
 * - Modération automatique avancée
 */

'use strict';

require('dotenv').config();
const fs = require('fs').promises;
const path = require('path');
const express = require('express');
const { 
    Client, GatewayIntentBits, EmbedBuilder, SlashCommandBuilder, 
    REST, Routes, ChannelType, PermissionFlagsBits, Collection, ActivityType,
    ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, 
    ButtonBuilder, ButtonStyle, StringSelectMenuBuilder
} = require('discord.js');

// ==========================================
// 1. CONFIGURATION & CONSTANTES IMMUTABLES
// ==========================================
const CONFIG = Object.freeze({
    prefix: process.env.BOT_PREFIX || '.',
    server: {
        id: process.env.GUILD_ID || '1490410149213507804',
        name: 'Ville de Québec Roleplay',
        icon: 'https://cdn.discordapp.com/icons/1490410149213507804/0b1aa46a2fdb33b133a0feb1234739f6.webp?size=1024',
        invite: 'https://discord.gg/UEf3epPwXS'
    },
    channels: { 
        logs: process.env.LOG_CHANNEL_ID || '1538659168012075029',
        suggestions: process.env.SUGGESTIONS_CHANNEL_ID || null,
        welcome: process.env.WELCOME_CHANNEL_ID || null
    },
    colors: { 
        primary: 0x003DA5, 
        success: 0x10b981, 
        warning: 0xf59e0b, 
        danger: 0xef4444, 
        info: 0x06b6d4,
        purple: 0x8b5cf6
    },
    limits: { 
        xpCooldown: 60000,
        dailyCooldown: 86400000,
        scanFiles: 10,
        commandCooldown: 5,
        maxWarnings: 3,
        giveawayDuration: 86400000
    },
    departments: {
        spvq: { 
            name: 'Service de Police (SPVQ)', 
            roles: { 
                director: process.env.ROLE_DIRECTEUR_SPVQ || 'ID', 
                manager: process.env.ROLE_MANAGER_SPVQ || 'ID', 
                agent: process.env.ROLE_AGENT_SPVQ || 'ID', 
                recruit: process.env.ROLE_RECRUE_SPVQ || 'ID' 
            },
            description: 'Service de police de la Ville de Québec'
        },
        spciq: { 
            name: 'Service Incendie (SPCIQ)', 
            roles: { 
                director: process.env.ROLE_DIRECTEUR_SPCIQ || 'ID', 
                manager: process.env.ROLE_MANAGER_SPCIQ || 'ID', 
                firefighter: process.env.ROLE_POMPIER_SPCIQ || 'ID', 
                recruit: process.env.ROLE_RECRUE_SPCIQ || 'ID' 
            },
            description: 'Service de protection contre les incendies'
        },
        sq: { 
            name: 'Sûreté du Québec (SQ)', 
            roles: { 
                director: process.env.ROLE_DIRECTEUR_SQ || 'ID', 
                manager: process.env.ROLE_MANAGER_SQ || 'ID', 
                agent: process.env.ROLE_AGENT_SQ || 'ID', 
                recruit: process.env.ROLE_RECRUE_SQ || 'ID' 
            },
            description: 'Force provinciale de police'
        }
    },
    automod: {
        badWords: ['insulte1', 'insulte2'],
        maxMentions: 5,
        maxLinks: 3,
        antiSpam: true
    }
});

// ==========================================
// 2. SYSTÈME DE CACHE LRU (Least Recently Used)
// ==========================================
class LRUCache {
    constructor(maxSize = 1000) {
        this.cache = new Map();
        this.maxSize = maxSize;
        this.stats = { hits: 0, misses: 0, sets: 0 };
    }

    get(key) {
        if (!this.cache.has(key)) {
            this.stats.misses++;
            return null;
        }
        const value = this.cache.get(key);
        this.cache.delete(key);
        this.cache.set(key, value);
        this.stats.hits++;
        return value;
    }

    set(key, value) {
        if (this.cache.has(key)) this.cache.delete(key);
        else if (this.cache.size >= this.maxSize) {
            this.cache.delete(this.cache.keys().next().value);
        }
        this.cache.set(key, value);
        this.stats.sets++;
    }

    has(key) {
        return this.cache.has(key);
    }

    delete(key) {
        return this.cache.delete(key);
    }

    clear() {
        this.cache.clear();
    }

    getStats() {
        const total = this.stats.hits + this.stats.misses;
        return {
            ...this.stats,
            size: this.cache.size,
            hitRate: total > 0 ? ((this.stats.hits / total) * 100).toFixed(2) + '%' : '0%'
        };
    }
}

const cache = new LRUCache(5000);

// ==========================================
// 3. JOURNALISATION STRUCTURÉE (Logger)
// ==========================================
class Logger {
    static LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3, FATAL: 4 };
    static currentLevel = Logger.LEVELS.INFO;
    static logs = [];
    static maxLogs = 10000;

    static _format(level, message, meta = {}) {
        const timestamp = new Date().toISOString();
        const logEntry = { timestamp, level, message, ...meta };
        this.logs.push(logEntry);
        if (this.logs.length > this.maxLogs) this.logs.shift();
        return `[${timestamp}] [${level}] ${message} ${Object.keys(meta).length ? JSON.stringify(meta) : ''}`;
    }

    static debug(msg, meta = {}) {
        if (Logger.currentLevel <= Logger.LEVELS.DEBUG) console.log(Logger._format('DEBUG', msg, meta));
    }

    static info(msg, meta = {}) {
        if (Logger.currentLevel <= Logger.LEVELS.INFO) console.log(Logger._format('INFO', msg, meta));
    }

    static warn(msg, meta = {}) {
        if (Logger.currentLevel <= Logger.LEVELS.WARN) console.warn(Logger._format('WARN', msg, meta));
    }

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
            const embed = new EmbedBuilder()
                .setTitle(title)
                .setDescription(desc)
                .setColor(color)
                .setFooter({ text: CONFIG.server.name, iconURL: CONFIG.server.icon })
                .setTimestamp();
            
            if (fields?.length) embed.addFields(fields);
            if (thumb) embed.setThumbnail(thumb);

            const channel = global.bot?.client?.channels?.cache?.get(CONFIG.channels.logs);
            if (channel) {
                await channel.send({ embeds: [embed] }).catch(e => Logger.error('Échec journal Discord', e));
            }
        } catch (err) {
            Logger.error('Erreur système journalisation', err);
        }
    }

    static getLogs(limit = 100) {
        return this.logs.slice(-limit);
    }

    static clearLogs() {
        this.logs = [];
    }
}

// ==========================================
// 4. BASE DE DONNÉES ATOMIQUE & ROBUSTE
// ==========================================
class AtomicDatabase {
    constructor(filePath) {
        this.filePath = filePath;
        this.data = {
            users: {},
            warnings: [],
            tickets: {},
            commands: {},
            tags: {},
            giveaways: {},
            reminders: {},
            stats: { messages: 0, commands: 0, members: 0 }
        };
        this.saveQueue = [];
        this.isSaving = false;
        this.backupInterval = null;
    }

    async init() {
        try {
            const content = await fs.readFile(this.filePath, 'utf8');
            this.data = { ...this.data, ...JSON.parse(content) };
            this._validateSchema();
            Logger.info('Base de données chargée et validée avec succès.');
            this._startAutoBackup();
        } catch (err) {
            if (err.code === 'ENOENT') { 
                await this.save(); 
                Logger.warn('Nouvelle base de données initialisée.'); 
                this._startAutoBackup();
            } else { 
                Logger.fatal('Corruption critique de la base de données', err); 
                throw err; 
            }
        }
    }

    _validateSchema() {
        const required = {
            users: {},
            warnings: [],
            tickets: {},
            commands: {},
            tags: {},
            giveaways: {},
            reminders: {},
            stats: { messages: 0, commands: 0, members: 0 }
        };
        for (const [key, defaultValue] of Object.entries(required)) {
            if (!(key in this.data)) this.data[key] = defaultValue;
        }
    }

    _startAutoBackup() {
        if (this.backupInterval) clearInterval(this.backupInterval);
        this.backupInterval = setInterval(async () => {
            try {
                await fs.copyFile(this.filePath, `${this.filePath}.backup`);
                Logger.debug('Sauvegarde automatique effectuée.');
            } catch (err) {
                Logger.error('Échec de la sauvegarde automatique', err);
            }
        }, 3600000); // Toutes les heures
    }

    async save() {
        if (this.isSaving) {
            this.saveQueue.push(() => this.save());
            return;
        }
        this.isSaving = true;
        try {
            const tempPath = `${this.filePath}.tmp`;
            await fs.writeFile(tempPath, JSON.stringify(this.data, null, 2), 'utf8');
            await fs.rename(tempPath, this.filePath);
            Logger.debug('Base de données sauvegardée avec succès.');
        } catch (err) {
            Logger.error('Échec sauvegarde BDD', err);
        } finally {
            this.isSaving = false;
            if (this.saveQueue.length > 0) this.saveQueue.shift()();
        }
    }

    // Méthodes Utilisateurs
    getUser(id) { 
        const cached = cache.get(`user_${id}`);
        if (cached) return cached;
        const user = this.data.users[id] || null;
        if (user) cache.set(`user_${id}`, user);
        return user; 
    }

    createUser(id, username) {
        this.data.users[id] = {
            id,
            username,
            level: 1,
            xp: 0,
            total_xp: 0,
            coins: 100,
            bank: 0,
            warnings: 0,
            last_xp: 0,
            last_daily: 0,
            created_at: new Date().toISOString()
        };
        cache.set(`user_${id}`, this.data.users[id]);
        this.save();
    }

    updateUser(id, updates) {
        if (this.data.users[id]) {
            Object.assign(this.data.users[id], updates);
            cache.set(`user_${id}`, this.data.users[id]);
            this.save();
        }
    }

    updateXP(id, xp, total_xp, level, last_xp) {
        this.updateUser(id, { xp, total_xp, level, last_xp });
    }

    updateCoins(id, amount) {
        this.updateUser(id, { coins: amount });
    }

    updateBank(id, amount) {
        this.updateUser(id, { bank: amount });
    }

    addWarning(id) {
        if (this.data.users[id]) {
            this.data.users[id].warnings++;
            cache.set(`user_${id}`, this.data.users[id]);
            this.save();
        }
    }

    getTopUsers(limit = 10) {
        return Object.values(this.data.users)
            .sort((a, b) => (b.total_xp || 0) - (a.total_xp || 0))
            .slice(0, limit);
    }

    // Méthodes Tickets
    createTicket(channelId, userId, reason) {
        this.data.tickets[channelId] = {
            channel_id: channelId,
            user_id: userId,
            reason,
            status: 'open',
            created_at: new Date().toISOString()
        };
        this.save();
    }

    closeTicket(channelId, closedBy) {
        if (this.data.tickets[channelId]) {
            this.data.tickets[channelId].status = 'closed';
            this.data.tickets[channelId].closed_at = new Date().toISOString();
            this.data.tickets[channelId].closed_by = closedBy;
            this.save();
        }
    }

    // Méthodes Commandes & Tags
    getCommand(name) {
        return this.data.commands[name] || null;
    }

    setCommand(name, response, createdBy) {
        this.data.commands[name] = {
            name,
            response,
            created_by: createdBy,
            created_at: new Date().toISOString()
        };
        this.save();
    }

    deleteCommand(name) {
        delete this.data.commands[name];
        this.save();
    }

    getTag(name) {
        return this.data.tags[name] || null;
    }

    setTag(name, content, createdBy) {
        this.data.tags[name] = {
            name,
            content,
            created_by: createdBy,
            uses: 0,
            created_at: new Date().toISOString()
        };
        this.save();
    }

    deleteTag(name) {
        delete this.data.tags[name];
        this.save();
    }

    incrementTagUses(name) {
        if (this.data.tags[name]) {
            this.data.tags[name].uses++;
            this.save();
        }
    }

    // Méthodes Giveaways
    createGiveaway(messageId, channelId, hostId, prize, winners, endsAt) {
        this.data.giveaways[messageId] = {
            message_id: messageId,
            channel_id: channelId,
            host_id: hostId,
            prize,
            winners,
            ends_at: endsAt,
            created_at: new Date().toISOString()
        };
        this.save();
    }

    deleteGiveaway(messageId) {
        delete this.data.giveaways[messageId];
        this.save();
    }

    getEndedGiveaways() {
        const now = Date.now();
        return Object.values(this.data.giveaways).filter(g => g.ends_at <= now);
    }

    // Méthodes Rappels
    createReminder(userId, message, expiresAt) {
        const id = `reminder_${Date.now()}_${userId}`;
        this.data.reminders[id] = {
            id,
            user_id: userId,
            message,
            expires_at: expiresAt,
            created_at: new Date().toISOString()
        };
        this.save();
        return id;
    }

    deleteReminder(id) {
        delete this.data.reminders[id];
        this.save();
    }

    getExpiredReminders() {
        const now = Date.now();
        return Object.values(this.data.reminders).filter(r => r.expires_at <= now);
    }

    // Statistiques
    incrementStat(stat) {
        if (this.data.stats[stat] !== undefined) {
            this.data.stats[stat]++;
            this.save();
        }
    }

    getStats() {
        return { ...this.data.stats };
    }

    async destroy() {
        if (this.backupInterval) clearInterval(this.backupInterval);
        await this.save();
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
        this.aliases = new Collection();
    }

    register(cmd) {
        this.commands.set(cmd.name, cmd);
        if (cmd.aliases) {
            for (const alias of cmd.aliases) {
                this.aliases.set(alias, cmd.name);
            }
        }
        Logger.debug(`Commande enregistrée : ${cmd.name}`);
    }

    getCommand(nameOrAlias) {
        return this.commands.get(nameOrAlias) || 
               this.commands.get(this.aliases.get(nameOrAlias));
    }

    async execute(interaction, isPrefix = false, message = null) {
        const cmdName = isPrefix ? interaction[0].toLowerCase() : interaction.commandName;
        const command = this.getCommand(cmdName);
        if (!command) return;

        // Middleware : Cooldown
        if (command.cooldown) {
            if (!this.cooldowns.has(command.name)) {
                this.cooldowns.set(command.name, new Collection());
            }
            const now = Date.now();
            const timestamps = this.cooldowns.get(command.name);
            const cooldown = (command.cooldown || CONFIG.limits.commandCooldown) * 1000;
            const userId = interaction.user?.id || interaction.author.id;

            if (timestamps.has(userId)) {
                const exp = timestamps.get(userId) + cooldown;
                if (now < exp) {
                    const timeLeft = ((exp - now) / 1000).toFixed(1);
                    const reply = isPrefix 
                        ? await message.channel.send(`Veuillez patienter **${timeLeft}s**.`)
                        : await interaction.reply({
                            embeds: [new EmbedBuilder()
                                .setTitle('Cooldown Actif')
                                .setDescription(`Veuillez patienter **${timeLeft} secondes**.`)
                                .setColor(CONFIG.colors.warning)],
                            ephemeral: true
                        });
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
                return message.channel.send({
                    embeds: [new EmbedBuilder()
                        .setTitle('Accès Refusé')
                        .setDescription('Vous ne possédez pas les permissions requises.')
                        .setColor(CONFIG.colors.danger)]
                });
            }
        }

        try {
            await command.execute(interaction, global.bot.client, db, isPrefix, message);
            db.incrementStat('commands');
        } catch (err) {
            Logger.error(`Erreur exécution commande: ${cmdName}`, err);
            const errEmbed = new EmbedBuilder()
                .setTitle('Erreur Système')
                .setDescription('Une erreur inattendue s\'est produite. L\'équipe a été notifiée.')
                .setColor(CONFIG.colors.danger);
            
            if (isPrefix) {
                await message.channel.send({ embeds: [errEmbed] });
            } else {
                await (interaction.replied || interaction.deferred 
                    ? interaction.followUp({ embeds: [errEmbed], ephemeral: true })
                    : interaction.reply({ embeds: [errEmbed], ephemeral: true }));
            }
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
            if (!user) {
                db.createUser(id, username);
                user = db.getUser(id);
            }
            return user;
        },
        async addXP(id, amount) {
            const user = db.getUser(id);
            if (!user || Date.now() - user.last_xp < CONFIG.limits.xpCooldown) return null;
            
            let { xp, total_xp, level } = user;
            xp += amount;
            total_xp += amount;
            let leveledUp = false;
            
            const needed = level * 100 + (level - 1) * 50;
            if (xp >= needed) {
                xp -= needed;
                level++;
                leveledUp = true;
            }
            
            db.updateXP(id, xp, total_xp, level, Date.now());
            return { level, leveledUp };
        },
        getLeaderboard(limit = 10) {
            return db.getTopUsers(limit);
        }
    },
    
    Economy: {
        async claimDaily(userId) {
            const user = db.getUser(userId);
            if (!user) return { success: false, error: 'Utilisateur introuvable.' };
            
            const now = Date.now();
            if (user.last_daily && now - user.last_daily < CONFIG.limits.dailyCooldown) {
                const remaining = CONFIG.limits.dailyCooldown - (now - user.last_daily);
                return { success: false, remaining };
            }
            
            const reward = Math.floor(Math.random() * 100) + 50;
            db.updateCoins(userId, user.coins + reward);
            db.updateUser(userId, { last_daily: now });
            
            return { success: true, reward };
        },
        async transfer(fromId, toId, amount) {
            const fromUser = db.getUser(fromId);
            const toUser = db.getUser(toId);
            
            if (!fromUser || !toUser) return { success: false, error: 'Utilisateur introuvable.' };
            if (fromUser.coins < amount) return { success: false, error: 'Fonds insuffisants.' };
            
            db.updateCoins(fromId, fromUser.coins - amount);
            db.updateCoins(toId, toUser.coins + amount);
            
            return { success: true };
        }
    },
    
    Moderation: {
        async warnUser(targetId, moderatorId, reason) {
            await Services.User.getOrCreate(targetId, 'Unknown');
            
            db.data.warnings.push({
                user_id: targetId,
                moderator_id: moderatorId,
                reason,
                created_at: new Date().toISOString()
            });
            
            db.addWarning(targetId);
            return db.getUser(targetId).warnings;
        },
        getWarnings(userId) {
            return db.data.warnings
                .filter(w => w.user_id === userId)
                .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        },
        async canModerate(moderator, target) {
            return moderator.roles.highest.position > target.roles.highest.position;
        }
    },
    
    Department: {
        get(key) {
            return CONFIG.departments[key?.toLowerCase()];
        },
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
                    if (target.roles.cache.has(rId)) {
                        await target.roles.remove(rId);
                    }
                }
                await target.roles.add(roleId);
                return { ok: true, grade: gradeKey, dept: dept.name };
            } catch (e) {
                return { ok: false, msg: e.message };
            }
        }
    },
    
    Ticket: {
        async create(guild, user, reason) {
            const channelName = `ticket-${user.username.toLowerCase()}`;
            const existing = guild.channels.cache.find(c => c.name === channelName);
            
            if (existing) {
                return { success: false, error: 'Vous avez déjà un ticket ouvert.' };
            }
            
            try {
                const ticketChannel = await guild.channels.create({
                    name: channelName,
                    type: ChannelType.GuildText,
                    permissionOverwrites: [
                        { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                        { id: user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }
                    ]
                });
                
                db.createTicket(ticketChannel.id, user.id, reason);
                
                return { success: true, channel: ticketChannel };
            } catch (e) {
                return { success: false, error: e.message };
            }
        },
        async close(channelId, closedBy) {
            db.closeTicket(channelId, closedBy);
        }
    },
    
    Reminder: {
        async create(userId, message, minutes) {
            const expiresAt = Date.now() + (minutes * 60 * 1000);
            const id = db.createReminder(userId, message, expiresAt);
            return { success: true, id, expiresAt };
        },
        getExpired() {
            return db.getExpiredReminders();
        },
        delete(id) {
            db.deleteReminder(id);
        }
    },
    
    Giveaway: {
        async create(messageId, channelId, hostId, prize, winners, durationMinutes) {
            const endsAt = Date.now() + (durationMinutes * 60 * 1000);
            db.createGiveaway(messageId, channelId, hostId, prize, winners, endsAt);
            return { success: true, endsAt };
        },
        getEnded() {
            return db.getEndedGiveaways();
        },
        delete(messageId) {
            db.deleteGiveaway(messageId);
        }
    }
};

// ==========================================
// 7. ENREGISTREMENT DES COMMANDES
// ==========================================
function setupCommands() {
    // --- PING ---
    cmdHandler.register({
        name: 'ping',
        slashData: new SlashCommandBuilder()
            .setName('ping')
            .setDescription('Vérifie la latence du système.'),
        execute: async (ctx, client) => {
            await ctx.reply({
                embeds: [new EmbedBuilder()
                    .setTitle('Latence Système')
                    .setDescription(`API Discord: **${client.ws.ping}ms**`)
                    .setColor(CONFIG.colors.primary)]
            });
        }
    });

    // --- HELP ---
    cmdHandler.register({
        name: 'help',
        slashData: new SlashCommandBuilder()
            .setName('help')
            .setDescription('Affiche la liste complète des commandes.'),
        execute: async (ctx) => {
            const embed = new EmbedBuilder()
                .setTitle('Centre de Commandes')
                .setDescription('Liste complète des fonctionnalités disponibles.')
                .setColor(CONFIG.colors.primary)
                .addFields(
                    { name: 'Informations', value: '`/ping`, `/help`, `/userinfo`, `/serverinfo`', inline: false },
                    { name: 'Progression', value: '`/rank`, `/leaderboard`, `/balance`, `/daily`, `/give`', inline: false },
                    { name: 'Modération', value: '`/warn`, `/warnings`, `/clear`, `/mute`, `/unmute`', inline: false },
                    { name: 'Support', value: '`/ticket`, `/close`', inline: false },
                    { name: 'Utilitaires', value: '`/tag`, `/tagadd`, `/tagdelete`, `/ccadd`, `/ccdelete`, `/remind`, `/giveaway`', inline: false },
                    { name: 'Départements', value: '`/promote`', inline: false }
                )
                .setFooter({ text: CONFIG.server.name, iconURL: CONFIG.server.icon })
                .setTimestamp();
            
            await ctx.reply({ embeds: [embed], ephemeral: true });
        }
    });

    // --- RANK ---
    cmdHandler.register({
        name: 'rank',
        slashData: new SlashCommandBuilder()
            .setName('rank')
            .setDescription('Affiche votre rang et votre expérience.')
            .addUserOption(o => o.setName('utilisateur').setDescription('L\'utilisateur à consulter')),
        execute: async (ctx) => {
            const target = ctx.options.getUser('utilisateur') || ctx.user;
            const user = await Services.User.getOrCreate(target.id, target.tag);
            
            const xpNeeded = user.level * 100 + (user.level - 1) * 50;
            const progress = Math.round((user.xp / xpNeeded) * 100);
            
            const embed = new EmbedBuilder()
                .setTitle(`Rang de ${target.username}`)
                .setDescription(`**Niveau :** ${user.level}\n**XP :** ${user.xp}/${xpNeeded} (${progress}%)\n**XP Total :** ${user.total_xp}`)
                .setColor(CONFIG.colors.primary)
                .setThumbnail(target.displayAvatarURL())
                .setFooter({ text: CONFIG.server.name, iconURL: CONFIG.server.icon })
                .setTimestamp();
            
            await ctx.reply({ embeds: [embed] });
        }
    });

    // --- LEADERBOARD ---
    cmdHandler.register({
        name: 'leaderboard',
        slashData: new SlashCommandBuilder()
            .setName('leaderboard')
            .setDescription('Affiche le classement de l\'expérience.'),
        execute: async (ctx) => {
            const topUsers = Services.User.getLeaderboard(10);
            
            if (topUsers.length === 0) {
                return ctx.reply({
                    embeds: [new EmbedBuilder()
                        .setTitle('Classement')
                        .setDescription('Aucune donnée disponible.')
                        .setColor(CONFIG.colors.info)]
                });
            }
            
            const description = topUsers.map((u, i) => {
                const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
                return `${medal} <@${u.id}> - Niveau ${u.level} (${u.total_xp} XP total)`;
            }).join('\n');
            
            const embed = new EmbedBuilder()
                .setTitle('Classement XP - Top 10')
                .setDescription(description)
                .setColor(CONFIG.colors.primary)
                .setFooter({ text: CONFIG.server.name, iconURL: CONFIG.server.icon })
                .setTimestamp();
            
            await ctx.reply({ embeds: [embed] });
        }
    });

    // --- BALANCE ---
    cmdHandler.register({
        name: 'balance',
        slashData: new SlashCommandBuilder()
            .setName('balance')
            .setDescription('Affiche votre solde.')
            .addUserOption(o => o.setName('utilisateur').setDescription('L\'utilisateur à consulter')),
        execute: async (ctx) => {
            const target = ctx.options.getUser('utilisateur') || ctx.user;
            const user = await Services.User.getOrCreate(target.id, target.tag);
            
            const embed = new EmbedBuilder()
                .setTitle(`Solde de ${target.username}`)
                .setDescription(`**Pièces :** ${user.coins}\n**Banque :** ${user.bank}\n**Total :** ${user.coins + user.bank}`)
                .setColor(CONFIG.colors.primary)
                .setThumbnail(target.displayAvatarURL())
                .setFooter({ text: CONFIG.server.name, iconURL: CONFIG.server.icon })
                .setTimestamp();
            
            await ctx.reply({ embeds: [embed] });
        }
    });

    // --- DAILY ---
    cmdHandler.register({
        name: 'daily',
        slashData: new SlashCommandBuilder()
            .setName('daily')
            .setDescription('Réclame ta récompense quotidienne.'),
        cooldown: 10,
        execute: async (ctx) => {
            const result = await Services.Economy.claimDaily(ctx.user.id);
            
            if (!result.success) {
                const hours = Math.ceil(result.remaining / 3600000);
                return ctx.reply({
                    embeds: [new EmbedBuilder()
                        .setTitle('Cooldown')
                        .setDescription(`Reviens dans **${hours} heure(s)**.`,)
                        .setColor(CONFIG.colors.warning)]
                });
            }
            
            await ctx.reply({
                embeds: [new EmbedBuilder()
                    .setTitle('Récompense Quotidienne')
                    .setDescription(`Tu as reçu **${result.reward} pièces** !`)
                    .setColor(CONFIG.colors.success)
                    .setFooter({ text: CONFIG.server.name, iconURL: CONFIG.server.icon })
                    .setTimestamp()]
            });
        }
    });

    // --- GIVE ---
    cmdHandler.register({
        name: 'give',
        slashData: new SlashCommandBuilder()
            .setName('give')
            .setDescription('Donner des pièces à quelqu\'un.')
            .addUserOption(o => o.setName('utilisateur').setDescription('L\'utilisateur').setRequired(true))
            .addIntegerOption(o => o.setName('montant').setDescription('Montant').setRequired(true)),
        cooldown: 10,
        execute: async (ctx) => {
            const target = ctx.options.getUser('utilisateur');
            const amount = ctx.options.getInteger('montant');
            
            if (target.id === ctx.user.id) {
                return ctx.reply({
                    embeds: [new EmbedBuilder()
                        .setTitle('Erreur')
                        .setDescription('Tu ne peux pas te donner des pièces à toi-même.')
                        .setColor(CONFIG.colors.danger)],
                    ephemeral: true
                });
            }
            
            const result = await Services.Economy.transfer(ctx.user.id, target.id, amount);
            
            if (!result.success) {
                return ctx.reply({
                    embeds: [new EmbedBuilder()
                        .setTitle('Erreur')
                        .setDescription(result.error)
                        .setColor(CONFIG.colors.danger)],
                    ephemeral: true
                });
            }
            
            await ctx.reply({
                embeds: [new EmbedBuilder()
                    .setTitle('Transfert Effectué')
                    .setDescription(`Tu as donné **${amount} pièces** à ${target}.`)
                    .setColor(CONFIG.colors.success)
                    .setFooter({ text: CONFIG.server.name, iconURL: CONFIG.server.icon })
                    .setTimestamp()]
            });
        }
    });

    // --- WARN ---
    cmdHandler.register({
        name: 'warn',
        slashData: new SlashCommandBuilder()
            .setName('warn')
            .setDescription('Avertit un membre.')
            .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
            .addUserOption(o => o.setName('membre').setDescription('Le membre').setRequired(true))
            .addStringOption(o => o.setName('raison').setDescription('Motif').setRequired(true)),
        permissions: [PermissionFlagsBits.ModerateMembers],
        cooldown: 5,
        execute: async (ctx) => {
            const target = ctx.options.getUser('membre');
            const reason = ctx.options.getString('raison');
            
            const warnCount = await Services.Moderation.warnUser(target.id, ctx.user.id, reason);
            
            await Logger.discord(
                'Avertissement Émis',
                `**${ctx.user.tag}** a averti **${target.tag}**.`,
                CONFIG.colors.warning,
                [{ name: 'Motif', value: reason }],
                target.displayAvatarURL()
            );
            
            try {
                await target.send({
                    embeds: [new EmbedBuilder()
                        .setTitle('Avertissement Officiel')
                        .setDescription(`Vous avez reçu un avertissement sur **${ctx.guild.name}**.\n\n**Motif :** ${reason}`)
                        .setColor(CONFIG.colors.warning)
                        .setTimestamp()]
                });
            } catch (e) {
                Logger.warn(`Impossible d'envoyer un MP à ${target.tag}`);
            }
            
            await ctx.reply({
                embeds: [new EmbedBuilder()
                    .setTitle('Avertissement Enregistré')
                    .setDescription(`${target.tag} a été averti.\n\n**Total des avertissements :** ${warnCount}`)
                    .setColor(CONFIG.colors.success)]
            });
        }
    });

    // --- WARNINGS ---
    cmdHandler.register({
        name: 'warnings',
        slashData: new SlashCommandBuilder()
            .setName('warnings')
            .setDescription('Voir les avertissements d\'un utilisateur.')
            .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
            .addUserOption(o => o.setName('utilisateur').setDescription('L\'utilisateur').setRequired(true)),
        permissions: [PermissionFlagsBits.ModerateMembers],
        execute: async (ctx) => {
            const target = ctx.options.getUser('utilisateur');
            const warnings = Services.Moderation.getWarnings(target.id);
            
            if (warnings.length === 0) {
                return ctx.reply({
                    embeds: [new EmbedBuilder()
                        .setTitle('Avertissements')
                        .setDescription('Aucun avertissement pour cet utilisateur.')
                        .setColor(CONFIG.colors.info)],
                    ephemeral: true
                });
            }
            
            const description = warnings.slice(0, 10).map(w => {
                return `**${w.reason}** - <t:${Math.floor(new Date(w.created_at).getTime() / 1000)}:R>\nPar <@${w.moderator_id}>`;
            }).join('\n\n');
            
            await ctx.reply({
                embeds: [new EmbedBuilder()
                    .setTitle(`Avertissements de ${target.username}`)
                    .setDescription(description)
                    .setColor(CONFIG.colors.warning)
                    .setThumbnail(target.displayAvatarURL())
                    .setFooter({ text: CONFIG.server.name, iconURL: CONFIG.server.icon })
                    .setTimestamp()],
                ephemeral: true
            });
        }
    });

    // --- CLEAR ---
    cmdHandler.register({
        name: 'clear',
        slashData: new SlashCommandBuilder()
            .setName('clear')
            .setDescription('Supprime des messages.')
            .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
            .addIntegerOption(o => o.setName('nombre').setDescription('Nombre (max 100)').setRequired(true).setMinValue(1).setMaxValue(100)),
        permissions: [PermissionFlagsBits.ManageMessages],
        cooldown: 10,
        execute: async (ctx) => {
            const amount = ctx.options.getInteger('nombre');
            
            try {
                await ctx.channel.bulkDelete(amount, true);
                await ctx.reply({
                    embeds: [new EmbedBuilder()
                        .setTitle('Messages Supprimés')
                        .setDescription(`${amount} messages ont été supprimés avec succès.`)
                        .setColor(CONFIG.colors.success)],
                    ephemeral: true
                });
                
                await Logger.discord(
                    'Messages Supprimés',
                    `**${ctx.user.tag}** a supprimé **${amount}** messages dans <#${ctx.channel.id}>.`,
                    CONFIG.colors.warning,
                    [],
                    ctx.user.displayAvatarURL()
                );
            } catch (error) {
                await ctx.reply({
                    embeds: [new EmbedBuilder()
                        .setTitle('Erreur')
                        .setDescription(`Impossible de supprimer les messages : ${error.message}`)
                        .setColor(CONFIG.colors.danger)],
                    ephemeral: true
                });
            }
        }
    });

    // --- TICKET ---
    cmdHandler.register({
        name: 'ticket',
        slashData: new SlashCommandBuilder()
            .setName('ticket')
            .setDescription('Ouvre un ticket de support.'),
        cooldown: 30,
        execute: async (ctx) => {
            const modal = new ModalBuilder()
                .setCustomId('ticket_modal')
                .setTitle('Création de Ticket');
            
            const reasonInput = new TextInputBuilder()
                .setCustomId('ticket_reason')
                .setLabel('Raison de la demande')
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(true);
            
            modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
            await ctx.showModal(modal);
        }
    });

    // --- CLOSE ---
    cmdHandler.register({
        name: 'close',
        slashData: new SlashCommandBuilder()
            .setName('close')
            .setDescription('Ferme le ticket actuel.')
            .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
        permissions: [PermissionFlagsBits.ManageChannels],
        execute: async (ctx) => {
            if (!ctx.channel.name.startsWith('ticket-')) {
                return ctx.reply({
                    embeds: [new EmbedBuilder()
                        .setTitle('Erreur')
                        .setDescription('Cette commande ne fonctionne que dans un ticket.')
                        .setColor(CONFIG.colors.danger)],
                    ephemeral: true
                });
            }
            
            await Services.Ticket.close(ctx.channel.id, ctx.user.id);
            
            await ctx.reply({
                embeds: [new EmbedBuilder()
                    .setTitle('Fermeture en Cours')
                    .setDescription('Le ticket sera fermé dans 5 secondes...')
                    .setColor(CONFIG.colors.warning)],
                ephemeral: true
            });
            
            setTimeout(async () => {
                await ctx.channel.delete();
                await Logger.discord(
                    'Ticket Fermé',
                    `Le ticket a été fermé par **${ctx.user.tag}**.`,
                    CONFIG.colors.warning,
                    [],
                    ctx.user.displayAvatarURL()
                );
            }, 5000);
        }
    });

    // --- TAGADD ---
    cmdHandler.register({
        name: 'tagadd',
        slashData: new SlashCommandBuilder()
            .setName('tagadd')
            .setDescription('Créer une étiquette.')
            .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
            .addStringOption(o => o.setName('nom').setDescription('Nom').setRequired(true))
            .addStringOption(o => o.setName('contenu').setDescription('Contenu').setRequired(true)),
        permissions: [PermissionFlagsBits.ManageGuild],
        execute: async (ctx) => {
            const name = ctx.options.getString('nom');
            const content = ctx.options.getString('contenu');
            
            try {
                db.setTag(name, content, ctx.user.id);
                await ctx.reply({
                    embeds: [new EmbedBuilder()
                        .setTitle('Succès')
                        .setDescription(`L'étiquette **${name}** a été créée.`)
                        .setColor(CONFIG.colors.success)],
                    ephemeral: true
                });
            } catch (e) {
                await ctx.reply({
                    embeds: [new EmbedBuilder()
                        .setTitle('Erreur')
                        .setDescription('Cette étiquette existe déjà.')
                        .setColor(CONFIG.colors.danger)],
                    ephemeral: true
                });
            }
        }
    });

    // --- TAGDELETE ---
    cmdHandler.register({
        name: 'tagdelete',
        slashData: new SlashCommandBuilder()
            .setName('tagdelete')
            .setDescription('Supprimer une étiquette.')
            .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
            .addStringOption(o => o.setName('nom').setDescription('Nom').setRequired(true)),
        permissions: [PermissionFlagsBits.ManageGuild],
        execute: async (ctx) => {
            const name = ctx.options.getString('nom');
            db.deleteTag(name);
            
            await ctx.reply({
                embeds: [new EmbedBuilder()
                    .setTitle('Succès')
                    .setDescription('Étiquette supprimée.')
                    .setColor(CONFIG.colors.success)],
                ephemeral: true
            });
        }
    });

    // --- CCADD ---
    cmdHandler.register({
        name: 'ccadd',
        slashData: new SlashCommandBuilder()
            .setName('ccadd')
            .setDescription('Créer une commande personnalisée.')
            .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
            .addStringOption(o => o.setName('nom').setDescription('Nom (sans !)').setRequired(true))
            .addStringOption(o => o.setName('réponse').setDescription('Réponse').setRequired(true)),
        permissions: [PermissionFlagsBits.ManageGuild],
        execute: async (ctx) => {
            const name = ctx.options.getString('nom');
            const response = ctx.options.getString('réponse');
            
            try {
                db.setCommand(name, response, ctx.user.id);
                await ctx.reply({
                    embeds: [new EmbedBuilder()
                        .setTitle('Succès')
                        .setDescription(`La commande **!${name}** a été créée.`)
                        .setColor(CONFIG.colors.success)],
                    ephemeral: true
                });
            } catch (e) {
                await ctx.reply({
                    embeds: [new EmbedBuilder()
                        .setTitle('Erreur')
                        .setDescription('Cette commande existe déjà.')
                        .setColor(CONFIG.colors.danger)],
                    ephemeral: true
                });
            }
        }
    });

    // --- CCDELETE ---
    cmdHandler.register({
        name: 'ccdelete',
        slashData: new SlashCommandBuilder()
            .setName('ccdelete')
            .setDescription('Supprimer une commande personnalisée.')
            .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
            .addStringOption(o => o.setName('nom').setDescription('Nom').setRequired(true)),
        permissions: [PermissionFlagsBits.ManageGuild],
        execute: async (ctx) => {
            const name = ctx.options.getString('nom');
            db.deleteCommand(name);
            
            await ctx.reply({
                embeds: [new EmbedBuilder()
                    .setTitle('Succès')
                    .setDescription('Commande supprimée.')
                    .setColor(CONFIG.colors.success)],
                ephemeral: true
            });
        }
    });

    // --- REMIND ---
    cmdHandler.register({
        name: 'remind',
        slashData: new SlashCommandBuilder()
            .setName('remind')
            .setDescription('Définir un rappel.')
            .addIntegerOption(o => o.setName('minutes').setDescription('Dans combien de minutes').setRequired(true))
            .addStringOption(o => o.setName('message').setDescription('Le rappel').setRequired(true)),
        cooldown: 10,
        execute: async (ctx) => {
            const minutes = ctx.options.getInteger('minutes');
            const message = ctx.options.getString('message');
            
            const result = await Services.Reminder.create(ctx.user.id, message, minutes);
            
            await ctx.reply({
                embeds: [new EmbedBuilder()
                    .setTitle('Rappel Défini')
                    .setDescription(`Tu seras notifié dans **${minutes} minute(s)** pour : "${message}"`)
                    .setColor(CONFIG.colors.success)
                    .setFooter({ text: CONFIG.server.name, iconURL: CONFIG.server.icon })
                    .setTimestamp()],
                ephemeral: true
            });
        }
    });

    // --- GIVEAWAY ---
    cmdHandler.register({
        name: 'giveaway',
        slashData: new SlashCommandBuilder()
            .setName('giveaway')
            .setDescription('Créer un tirage au sort.')
            .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
            .addStringOption(o => o.setName('prix').setDescription('Le prix').setRequired(true))
            .addIntegerOption(o => o.setName('durée').setDescription('Durée en minutes').setRequired(true))
            .addIntegerOption(o => o.setName('gagnants').setDescription('Nombre de gagnants').setRequired(true)),
        permissions: [PermissionFlagsBits.ManageGuild],
        cooldown: 30,
        execute: async (ctx) => {
            const prize = ctx.options.getString('prix');
            const duration = ctx.options.getInteger('durée');
            const winners = ctx.options.getInteger('gagnants');
            
            const embed = new EmbedBuilder()
                .setTitle('TIRAGE AU SORT')
                .setDescription(`**Prix :** ${prize}\n**Durée :** ${duration} minutes\n**Gagnants :** ${winners}\n\nRéagissez avec 🎉 pour participer !`)
                .setColor(CONFIG.colors.purple)
                .setFooter({ text: `Se termine`, iconURL: CONFIG.server.icon })
                .setTimestamp(Date.now() + duration * 60 * 1000);
            
            const message = await ctx.channel.send({ embeds: [embed] });
            await message.react('🎉');
            
            await Services.Giveaway.create(message.id, ctx.channel.id, ctx.user.id, prize, winners, duration);
            
            await ctx.reply({
                embeds: [new EmbedBuilder()
                    .setTitle('Tirage au Sort Créé')
                    .setDescription(`Giveaway pour **${prize}** lancé !`)
                    .setColor(CONFIG.colors.success)],
                ephemeral: true
            });
        }
    });

    // --- USERINFO ---
    cmdHandler.register({
        name: 'userinfo',
        slashData: new SlashCommandBuilder()
            .setName('userinfo')
            .setDescription('Affiche les informations d\'un utilisateur.')
            .addUserOption(o => o.setName('membre').setDescription('Le membre')),
        execute: async (ctx) => {
            const member = ctx.options.getMember('membre') || ctx.member;
            const roles = member.roles.cache.filter(r => r.id !== ctx.guild.id).map(r => r.name).join(', ') || 'Aucun';
            
            const embed = new EmbedBuilder()
                .setTitle(`Informations de ${member.user.username}`)
                .setColor(CONFIG.colors.primary)
                .setThumbnail(member.user.displayAvatarURL())
                .addFields(
                    { name: 'Pseudonyme', value: member.displayName, inline: true },
                    { name: 'Identifiant', value: member.id, inline: true },
                    { name: 'Compte créé le', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:D>`, inline: true },
                    { name: 'A rejoint le', value: member.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:D>` : 'Inconnu', inline: true },
                    { name: 'Rôles', value: roles.substring(0, 1000), inline: false }
                )
                .setFooter({ text: CONFIG.server.name, iconURL: CONFIG.server.icon })
                .setTimestamp();
            
            await ctx.reply({ embeds: [embed] });
        }
    });

    // --- SERVERINFO ---
    cmdHandler.register({
        name: 'serverinfo',
        slashData: new SlashCommandBuilder()
            .setName('serverinfo')
            .setDescription('Affiche les informations du serveur.'),
        execute: async (ctx) => {
            const guild = ctx.guild;
            
            const embed = new EmbedBuilder()
                .setTitle(`Informations du Serveur`)
                .setDescription(`Détails de **${guild.name}**.`)
                .setColor(CONFIG.colors.primary)
                .setThumbnail(guild.iconURL())
                .addFields(
                    { name: 'Propriétaire', value: `<@${guild.ownerId}>`, inline: true },
                    { name: 'Identifiant', value: guild.id, inline: true },
                    { name: 'Membres', value: `${guild.memberCount}`, inline: true },
                    { name: 'Catégories', value: `${guild.channels.cache.filter(c => c.type === ChannelType.GuildCategory).size}`, inline: true },
                    { name: 'Salons', value: `${guild.channels.cache.size}`, inline: true },
                    { name: 'Rôles', value: `${guild.roles.cache.size}`, inline: true },
                    { name: 'Création', value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:D>`, inline: false }
                )
                .setFooter({ text: CONFIG.server.name, iconURL: CONFIG.server.icon })
                .setTimestamp();
            
            await ctx.reply({ embeds: [embed] });
        }
    });

    // --- PROMOTE ---
    cmdHandler.register({
        name: 'promote',
        slashData: new SlashCommandBuilder()
            .setName('promote')
            .setDescription('Promouvoir un membre (Réservé aux directeurs).')
            .addUserOption(o => o.setName('utilisateur').setDescription('Le membre à promouvoir').setRequired(true))
            .addStringOption(o => o.setName('département').setDescription('Le département').setRequired(true)
                .addChoices(
                    { name: 'SPVQ', value: 'spvq' },
                    { name: 'SPCIQ', value: 'spciq' },
                    { name: 'SQ', value: 'sq' }
                ))
            .addStringOption(o => o.setName('grade').setDescription('Le nouveau grade').setRequired(true)),
        permissions: [PermissionFlagsBits.ManageRoles],
        cooldown: 5,
        execute: async (ctx) => {
            const target = ctx.options.getMember('utilisateur');
            const deptKey = ctx.options.getString('département');
            const grade = ctx.options.getString('grade');
            
            if (!Services.Department.isDirector(ctx.member, deptKey)) {
                const dept = Services.Department.get(deptKey);
                return ctx.reply({
                    embeds: [new EmbedBuilder()
                        .setTitle('Accès Refusé')
                        .setDescription(`Seul le directeur du ${dept?.name || 'département'} est autorisé.`)
                        .setColor(CONFIG.colors.danger)],
                    ephemeral: true
                });
            }
            
            const result = await Services.Department.promote(target, deptKey, grade);
            
            if (!result.ok) {
                return ctx.reply({
                    embeds: [new EmbedBuilder()
                        .setTitle('Erreur')
                        .setDescription(result.msg)
                        .setColor(CONFIG.colors.danger)],
                    ephemeral: true
                });
            }
            
            const dept = Services.Department.get(deptKey);
            
            await Logger.discord(
                'Promotion Départementale',
                `**${target.user.tag}** promu **${result.grade}** dans **${result.dept}**.`,
                CONFIG.colors.success,
                [{ name: 'Promu par', value: `${ctx.user.tag}`, inline: true }],
                target.user.displayAvatarURL()
            );
            
            await ctx.reply({
                embeds: [new EmbedBuilder()
                    .setTitle('Promotion Réussie')
                    .setDescription(`${target.user.tag} est maintenant **${result.grade}** au sein du ${dept.name}.`)
                    .setColor(CONFIG.colors.success)]
            });
        }
    });

    // --- SCAN ---
    cmdHandler.register({
        name: 'scan',
        slashData: new SlashCommandBuilder()
            .setName('scan')
            .setDescription('Analyse complète et génération de 10 fichiers JSON équilibrés.'),
        cooldown: 120,
        execute: async (ctx) => {
            await ctx.deferReply({ ephemeral: true });
            
            try {
                const guild = ctx.guild;
                Logger.info(`Démarrage de l'analyse du serveur ${guild.name}`);
                
                const items = [];
                
                items.push({
                    _type: 'server_info',
                    id: guild.id,
                    name: guild.name,
                    ownerId: guild.ownerId,
                    memberCount: guild.memberCount,
                    createdAt: guild.createdAt.toISOString(),
                    description: guild.description,
                    iconURL: guild.iconURL(),
                    features: guild.features
                });

                guild.channels.cache.forEach(ch => {
                    items.push({
                        _type: 'channel',
                        id: ch.id,
                        name: ch.name,
                        type: ChannelType[ch.type],
                        parentId: ch.parentId,
                        position: ch.position,
                        topic: ch.topic,
                        nsfw: ch.nsfw
                    });
                });

                guild.roles.cache.forEach(role => {
                    items.push({
                        _type: 'role',
                        id: role.id,
                        name: role.name,
                        color: role.hexColor,
                        position: role.position,
                        permissions: role.permissions.toArray(),
                        hoist: role.hoist,
                        mentionable: role.mentionable
                    });
                });

                guild.members.cache.forEach(m => {
                    items.push({
                        _type: 'member',
                        id: m.id,
                        username: m.user.username,
                        displayName: m.displayName,
                        roles: m.roles.cache.filter(r => r.id !== guild.id).map(r => r.name),
                        joinedAt: m.joinedAt?.toISOString(),
                        premiumSince: m.premiumSince?.toISOString()
                    });
                });

                Logger.info(`Collecte terminée : ${items.length} éléments`);

                items.sort((a, b) => JSON.stringify(b).length - JSON.stringify(a).length);
                
                const numFiles = CONFIG.limits.scanFiles;
                const buckets = Array.from({ length: numFiles }, () => ({ items: [], size: 0 }));
                
                for (const item of items) {
                    const itemSize = JSON.stringify(item).length;
                    const smallestBucket = buckets.reduce((prev, curr) => 
                        prev.size < curr.size ? prev : curr
                    );
                    smallestBucket.items.push(item);
                    smallestBucket.size += itemSize;
                }

                const totalSize = buckets.reduce((sum, b) => sum + b.size, 0);
                const avgSize = totalSize / numFiles;
                
                const files = [];
                const timestamp = Date.now();
                const safeName = guild.name.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '');
                
                for (let i = 0; i < numFiles; i++) {
                    const metaData = {
                        _meta: {
                            file: i + 1,
                            total_files: numFiles,
                            server: guild.name,
                            server_id: guild.id,
                            timestamp: new Date().toISOString(),
                            item_count: buckets[i].items.length,
                            size_bytes: buckets[i].size,
                            size_kb: Math.round(buckets[i].size / 1024),
                            average_size_kb: Math.round(avgSize / 1024)
                        },
                        data: buckets[i].items
                    };

                    files.push({
                        attachment: Buffer.from(JSON.stringify(metaData, null, 2), 'utf-8'),
                        name: `analyse_partie_${String(i + 1).padStart(2, '0')}_sur_${numFiles}_${safeName}_${timestamp}.json`
                    });
                }

                Logger.info(`Génération de ${files.length} fichiers terminée`);

                await ctx.followUp({
                    embeds: [new EmbedBuilder()
                        .setTitle('Analyse Terminée')
                        .setDescription(`L'analyse a généré **${numFiles} fichiers JSON** contenant l'intégralité des données du serveur.\n\n**Statistiques :**\n• Taille moyenne : ${Math.round(avgSize / 1024)} KB\n• Taille maximale : ${Math.round(Math.max(...buckets.map(b => b.size)) / 1024)} KB\n• Taille minimale : ${Math.round(Math.min(...buckets.map(b => b.size)) / 1024)} KB`)
                        .setColor(CONFIG.colors.success)
                        .setTimestamp()],
                    files: files,
                    ephemeral: true
                });

                await Logger.discord(
                    'Analyse du Serveur',
                    `**${ctx.user.tag}** a effectué une analyse complète du serveur **${guild.name}**.`,
                    CONFIG.colors.info,
                    [
                        { name: 'Fichiers générés', value: `${numFiles}`, inline: true },
                        { name: 'Éléments analysés', value: `${items.length}`, inline: true }
                    ],
                    ctx.user.displayAvatarURL()
                );
            } catch (error) {
                Logger.error('Échec de l\'analyse', error);
                await ctx.followUp({
                    embeds: [new EmbedBuilder()
                        .setTitle('Erreur Critique')
                        .setDescription(`Une erreur s'est produite lors de l'analyse du serveur.\n\n**Erreur :** ${error.message}`)
                        .setColor(CONFIG.colors.danger)],
                    ephemeral: true
                });
            }
        }
    });
}

// ==========================================
// 8. CLASSE PRINCIPALE DU BOT (Framework)
// ==========================================
class VQCBot {
    constructor() {
        this.client = new Client({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMembers,
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.MessageContent,
                GatewayIntentBits.GuildModeration,
                GatewayIntentBits.GuildVoiceStates,
                GatewayIntentBits.GuildMessageReactions,
                GatewayIntentBits.GuildPresences
            ]
        });
        this.expressApp = express();
        this.startTime = Date.now();
        
        this.setupExpress();
        this.setupEvents();
        this.setupIntervals();
    }

    setupExpress() {
        this.expressApp.use(express.json());
        this.expressApp.use((req, res, next) => {
            res.header('Access-Control-Allow-Origin', '*');
            res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
            next();
        });

        this.expressApp.get('/', (req, res) => {
            const uptime = Math.floor((Date.now() - this.startTime) / 1000);
            res.status(200).json({
                status: 'online',
                name: CONFIG.server.name,
                uptime: uptime,
                version: '13.0.0',
                cache: cache.getStats(),
                database: {
                    users: Object.keys(db.data.users).length,
                    commands: Object.keys(db.data.commands).length,
                    tags: Object.keys(db.data.tags).length,
                    tickets: Object.keys(db.data.tickets).length
                }
            });
        });

        this.expressApp.get('/api/stats', (req, res) => {
            const guild = this.client.guilds.cache.get(CONFIG.server.id);
            if (!guild) return res.status(404).json({ error: 'Serveur introuvable.' });

            const onlineCount = guild.members.cache.filter(m => 
                !m.user.bot && m.presence?.status !== 'offline'
            ).size;

            const uptime = Math.floor((Date.now() - this.startTime) / 1000);

            res.json({
                totalMembers: guild.memberCount,
                onlineMembers: onlineCount,
                botPing: this.client.ws.ping,
                uptime: uptime,
                stats: db.getStats()
            });
        });

        this.expressApp.get('/api/leaderboard', (req, res) => {
            const limit = parseInt(req.query.limit) || 10;
            const topUsers = Services.User.getLeaderboard(limit);
            res.json({ leaderboard: topUsers });
        });

        this.expressApp.get('/api/health', (req, res) => {
            res.status(200).json({
                status: 'healthy',
                uptime: Math.floor((Date.now() - this.startTime) / 1000),
                memory: process.memoryUsage(),
                cache: cache.getStats(),
                database: {
                    size: Object.keys(db.data.users).length,
                    warnings: db.data.warnings.length,
                    tickets: Object.keys(db.data.tickets).length
                }
            });
        });

        const PORT = process.env.PORT || 3000;
        this.expressApp.listen(PORT, '0.0.0.0', () => {
            Logger.success(`Serveur API actif sur http://0.0.0.0:${PORT}`);
        });
    }

    setupEvents() {
        this.client.once('clientReady', async () => {
            Logger.success(`Connecté en tant que ${this.client.user.tag}`);
            Logger.info(`Serveurs : ${this.client.guilds.cache.size}`);
            Logger.info(`Utilisateurs : ${this.client.users.cache.size}`);
            
            this.client.user.setPresence({
                activities: [{ name: 'Ville de Québec Roleplay', type: ActivityType.Watching }],
                status: 'online'
            });
            
            await Logger.discord(
                'Système Démarré',
                `Le bot est désormais opérationnel.\n\n**Identité :** ${this.client.user.tag}\n**Uptime :** 0 secondes`,
                CONFIG.colors.success,
                [],
                this.client.user.displayAvatarURL()
            );
            
            try {
                const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
                await rest.put(
                    Routes.applicationGuildCommands(this.client.user.id, CONFIG.server.id),
                    { body: Array.from(cmdHandler.commands.values()).map(cmd => cmd.slashData.toJSON()) }
                );
                Logger.success('Commandes slash enregistrées avec succès.');
            } catch (error) {
                Logger.error('Échec de l\'enregistrement des commandes', error);
            }
        });

        this.client.on('guildMemberAdd', async (member) => {
            if (member.guild.id !== CONFIG.server.id) return;
            
            await Services.User.getOrCreate(member.id, member.user.tag);
            db.incrementStat('members');
            
            await Logger.discord(
                'Nouveau Membre',
                `**${member.user.tag}** a rejoint le serveur.`,
                CONFIG.colors.success,
                [
                    { name: 'Identifiant', value: member.id, inline: true },
                    { name: 'Compte créé', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, inline: true }
                ],
                member.user.displayAvatarURL()
            );
        });

        this.client.on('guildMemberRemove', async (member) => {
            if (member.guild.id !== CONFIG.server.id) return;
            
            await Logger.discord(
                'Membre Parti',
                `**${member.user.tag}** a quitté le serveur.`,
                CONFIG.colors.danger,
                [
                    { name: 'Identifiant', value: member.id, inline: true },
                    { name: 'A rejoint le', value: member.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>` : 'Inconnu', inline: true }
                ],
                member.user.displayAvatarURL()
            );
        });

        this.client.on('messageCreate', async (message) => {
            if (message.author.bot || message.guild?.id !== CONFIG.server.id) return;

            db.incrementStat('messages');

            // Gestion des commandes préfixées
            if (message.content.startsWith(CONFIG.prefix)) {
                const args = message.content.slice(CONFIG.prefix.length).trim().split(/ +/);
                await cmdHandler.execute(args, true, message);
                return;
            }

            // Système de tags préfixés
            if (message.content.toLowerCase().startsWith('.tag ')) {
                const tagName = message.content.slice(5).trim().toLowerCase();
                const tag = db.getTag(tagName);
                if (tag) {
                    db.incrementTagUses(tagName);
                    await message.reply(tag.content).catch(() => {});
                }
            }

            // Système de niveaux (XP)
            await Services.User.getOrCreate(message.author.id, message.author.tag);
            const xpResult = await Services.User.addXP(message.author.id, Math.floor(Math.random() * 15) + 10);
            
            if (xpResult?.leveledUp) {
                message.reply({
                    embeds: [new EmbedBuilder()
                        .setTitle('Niveau Supérieur')
                        .setDescription(`Félicitations ${message.author}, vous êtes passé au niveau **${xpResult.level}**.`)
                        .setColor(CONFIG.colors.success)]
                }).catch(() => {});
            }

            // Modération automatique
            if (CONFIG.automod.antiSpam) {
                const content = message.content.toLowerCase();
                if (CONFIG.automod.badWords.some(word => content.includes(word))) {
                    await message.delete().catch(() => {});
                    await message.channel.send(`${message.author}, votre message a été supprimé car il contenait des mots interdits.`).catch(() => {});
                    await Logger.discord(
                        'Modération Automatique',
                        `**${message.author.tag}** a envoyé un message avec des mots interdits.`,
                        CONFIG.colors.warning,
                        [],
                        message.author.displayAvatarURL()
                    );
                }
            }
        });

        this.client.on('interactionCreate', async (interaction) => {
            if (interaction.isChatInputCommand()) {
                await cmdHandler.execute(interaction);
            } else if (interaction.isModalSubmit()) {
                if (interaction.customId === 'ticket_modal') {
                    const reason = interaction.fields.getTextInputValue('ticket_reason');
                    const result = await Services.Ticket.create(interaction.guild, interaction.user, reason);
                    
                    if (!result.success) {
                        return interaction.reply({
                            embeds: [new EmbedBuilder()
                                .setTitle('Erreur')
                                .setDescription(result.error)
                                .setColor(CONFIG.colors.danger)],
                            ephemeral: true
                        });
                    }
                    
                    await result.channel.send({
                        content: `${interaction.user}`,
                        embeds: [new EmbedBuilder()
                            .setTitle('Nouveau Ticket de Support')
                            .setDescription(`**Raison :** ${reason}\n\nUn membre de l'équipe de direction va prendre en charge votre demande dans les plus brefs délais.`)
                            .setColor(CONFIG.colors.primary)
                            .setTimestamp()]
                    });
                    
                    await interaction.reply({
                        embeds: [new EmbedBuilder()
                            .setTitle('Succès')
                            .setDescription(`Votre ticket a été créé : ${result.channel}`)
                            .setColor(CONFIG.colors.success)],
                        ephemeral: true
                    });
                    
                    await Logger.discord(
                        'Ticket Créé',
                        `**${interaction.user.tag}** a ouvert un ticket : <#${result.channel.id}>`,
                        CONFIG.colors.info,
                        [],
                        interaction.user.displayAvatarURL()
                    );
                }
            }
        });

        process.on('SIGINT', () => this.shutdown());
        process.on('SIGTERM', () => this.shutdown());
    }

    setupIntervals() {
        // Vérification des rappels toutes les minutes
        setInterval(async () => {
            const expired = Services.Reminder.getExpired();
            
            for (const reminder of expired) {
                try {
                    const user = await this.client.users.fetch(reminder.user_id);
                    await user.send({
                        embeds: [new EmbedBuilder()
                            .setTitle('Rappel')
                            .setDescription(reminder.message)
                            .setColor(CONFIG.colors.info)
                            .setTimestamp()]
                    });
                    Services.Reminder.delete(reminder.id);
                } catch (error) {
                    Logger.error(`Échec envoi rappel à ${reminder.user_id}`, error);
                }
            }
        }, 60000);

        // Vérification des giveaways toutes les minutes
        setInterval(async () => {
            const ended = Services.Giveaway.getEnded();
            
            for (const giveaway of ended) {
                try {
                    const channel = await this.client.channels.fetch(giveaway.channel_id);
                    if (!channel) continue;
                    
                    const message = await channel.messages.fetch(giveaway.message_id);
                    if (!message) continue;
                    
                    const reaction = message.reactions.cache.find(r => r.emoji.name === '🎉');
                    if (!reaction) continue;
                    
                    const users = await reaction.users.fetch();
                    const participants = users.filter(u => !u.bot && u.id !== this.client.user.id);
                    
                    if (participants.size === 0) {
                        await channel.send({
                            embeds: [new EmbedBuilder()
                                .setTitle('Tirage au Sort Terminé')
                                .setDescription('Aucun participant valide.')
                                .setColor(CONFIG.colors.danger)]
                        });
                    } else {
                        const winners = [];
                        const participantsArray = Array.from(participants.values());
                        
                        for (let i = 0; i < Math.min(giveaway.winners, participantsArray.length); i++) {
                            const winner = participantsArray[Math.floor(Math.random() * participantsArray.length)];
                            winners.push(winner);
                            participantsArray.splice(participantsArray.indexOf(winner), 1);
                        }
                        
                        await channel.send({
                            embeds: [new EmbedBuilder()
                                .setTitle('Tirage au Sort Terminé')
                                .setDescription(`**Prix :** ${giveaway.prize}\n**Gagnant(s) :** ${winners.map(w => `<@${w.id}>`).join(', ')}`)
                                .setColor(CONFIG.colors.success)]
                        });
                    }
                    
                    Services.Giveaway.delete(giveaway.message_id);
                } catch (error) {
                    Logger.error(`Erreur giveaway ${giveaway.message_id}`, error);
                }
            }
        }, 60000);
    }

    async shutdown() {
        Logger.info('Arrêt du bot en cours...');
        await db.destroy();
        this.client.destroy();
        process.exit(0);
    }

    async start() {
        try {
            Logger.info('Initialisation de la base de données...');
            await db.init();
            
            Logger.info('Configuration des modules de commandes...');
            setupCommands();
            
            Logger.info('Connexion à Discord...');
            await this.client.login(process.env.DISCORD_TOKEN);
            
            Logger.success('Bot démarré avec succès.');
        } catch (error) {
            Logger.fatal('Échec critique au démarrage', error);
            process.exit(1);
        }
    }
}

// ==========================================
// 9. INITIALISATION GLOBALE
// ==========================================
global.bot = new VQCBot();
global.bot.start().catch(err => {
    Logger.fatal('Erreur fatale', err);
    process.exit(1);
});
