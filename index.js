/**
 * VQC Discord Bot - Enterprise Edition
 * Architecture modulaire avec patterns avancés
 * Version: 8.0.0 (Production Ready)
 * 
 * @author Jacobin Babouain
 * @description Bot Discord professionnel pour Ville de Québec Roleplay
 * @license MIT
 */

'use strict';

require('dotenv').config();
const fs = require('fs').promises;
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const { 
    Client, GatewayIntentBits, EmbedBuilder, SlashCommandBuilder, 
    REST, Routes, ChannelType, PermissionFlagsBits, Collection, ActivityType,
    ActionRowBuilder, ButtonBuilder, ButtonStyle
} = require('discord.js');

// ==========================================
// 1. CONFIGURATION ET CONSTANTES
// ==========================================
const CONFIG = Object.freeze({
    prefix: process.env.BOT_PREFIX || '.',
    environment: process.env.NODE_ENV || 'development',
    server: {
        id: process.env.GUILD_ID || '1490410149213507804',
        name: 'Ville de Québec Roleplay',
        icon: 'https://cdn.discordapp.com/icons/1490410149213507804/0b1aa46a2fdb33b133a0feb1234739f6.webp?size=1024'
    },
    channels: {
        logs: process.env.LOG_CHANNEL_ID || '1538659168012075029'
    },
    colors: {
        primary: 0x003DA5,
        success: 0x10b981,
        warning: 0xf59e0b,
        danger: 0xef4444,
        info: 0x06b6d4
    },
    limits: {
        xpCooldown: 60000,
        dailyCooldown: 86400000,
        maxWarnings: 3,
        scanFiles: 10,
        apiRateLimit: 100,
        commandCooldown: 5
    },
    departments: {
        spvq: {
            name: 'Service de Police (SPVQ)',
            roles: {
                director: process.env.ROLE_DIRECTEUR_SPVQ || 'ID_ROLE_DIRECTEUR_SPVQ',
                manager: process.env.ROLE_MANAGER_SPVQ || 'ID_ROLE_MANAGER_SPVQ',
                agent: process.env.ROLE_AGENT_SPVQ || 'ID_ROLE_AGENT_SPVQ',
                recruit: process.env.ROLE_RECRUE_SPVQ || 'ID_ROLE_RECRUE_SPVQ'
            }
        },
        spciq: {
            name: 'Service Incendie (SPCIQ)',
            roles: {
                director: process.env.ROLE_DIRECTEUR_SPCIQ || 'ID_ROLE_DIRECTEUR_SPCIQ',
                manager: process.env.ROLE_MANAGER_SPCIQ || 'ID_ROLE_MANAGER_SPCIQ',
                firefighter: process.env.ROLE_POMPIER_SPCIQ || 'ID_ROLE_POMPIER_SPCIQ',
                recruit: process.env.ROLE_RECRUE_SPCIQ || 'ID_ROLE_RECRUE_SPCIQ'
            }
        },
        sq: {
            name: 'Sûreté du Québec (SQ)',
            roles: {
                director: process.env.ROLE_DIRECTEUR_SQ || 'ID_ROLE_DIRECTEUR_SQ',
                manager: process.env.ROLE_MANAGER_SQ || 'ID_ROLE_MANAGER_SQ',
                agent: process.env.ROLE_AGENT_SQ || 'ID_ROLE_AGENT_SQ',
                recruit: process.env.ROLE_RECRUE_SQ || 'ID_ROLE_RECRUE_SQ'
            }
        }
    },
    database: {
        path: process.env.DB_PATH || path.join(__dirname, 'vqc_data.json'),
        backupInterval: 3600000,
        saveDebounce: 3000
    }
});

// ==========================================
// 2. SYSTÈME DE JOURNALISATION AVANCÉ
// ==========================================
class Logger {
    static LEVELS = Object.freeze({
        DEBUG: 0,
        INFO: 1,
        WARN: 2,
        ERROR: 3,
        FATAL: 4
    });

    static currentLevel = Logger.LEVELS.INFO;
    static logs = [];
    static maxLogs = 10000;

    static format(level, message, meta = {}) {
        const timestamp = new Date().toISOString();
        const logEntry = {
            timestamp,
            level,
            message,
            ...meta
        };
        
        this.logs.push(logEntry);
        if (this.logs.length > this.maxLogs) {
            this.logs.shift();
        }
        
        return JSON.stringify(logEntry);
    }

    static debug(message, meta = {}) {
        if (Logger.currentLevel <= Logger.LEVELS.DEBUG) {
            console.log(Logger.format('DEBUG', message, meta));
        }
    }

    static info(message, meta = {}) {
        if (Logger.currentLevel <= Logger.LEVELS.INFO) {
            console.log(Logger.format('INFO', message, meta));
        }
    }

    static warn(message, meta = {}) {
        if (Logger.currentLevel <= Logger.LEVELS.WARN) {
            console.warn(Logger.format('WARN', message, meta));
        }
    }

    static error(message, error = null, meta = {}) {
        const errorMeta = error ? {
            errorName: error.name,
            errorMessage: error.message,
            errorStack: error.stack,
            ...meta
        } : meta;
        
        console.error(Logger.format('ERROR', message, errorMeta));
    }

    static fatal(message, error = null, meta = {}) {
        const errorMeta = error ? {
            errorName: error.name,
            errorMessage: error.message,
            errorStack: error.stack,
            ...meta
        } : meta;
        
        console.error(Logger.format('FATAL', message, errorMeta));
    }

    static async discord(title, description, color = CONFIG.colors.primary, fields = [], thumbnail = null) {
        try {
            const embed = new EmbedBuilder()
                .setTitle(title)
                .setDescription(description)
                .setColor(color)
                .setFooter({ text: CONFIG.server.name, iconURL: CONFIG.server.icon })
                .setTimestamp();

            if (fields?.length) embed.addFields(fields);
            if (thumbnail) embed.setThumbnail(thumbnail);

            const channel = bot?.client?.channels?.cache?.get(CONFIG.channels.logs);
            if (channel) {
                await channel.send({ embeds: [embed] }).catch(err => {
                    Logger.error('Échec de l\'envoi du journal Discord', err);
                });
            }
        } catch (err) {
            Logger.error('Erreur dans le système de journalisation Discord', err);
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
// 3. SYSTÈME DE CACHE AVANCÉ
// ==========================================
class CacheManager {
    constructor(defaultTTL = 60000) {
        this.cache = new Map();
        this.defaultTTL = defaultTTL;
        this.stats = {
            hits: 0,
            misses: 0,
            sets: 0,
            deletes: 0
        };
    }

    get(key) {
        const item = this.cache.get(key);
        if (!item) {
            this.stats.misses++;
            return null;
        }

        if (Date.now() > item.expiry) {
            this.cache.delete(key);
            this.stats.misses++;
            return null;
        }

        this.stats.hits++;
        return item.value;
    }

    set(key, value, ttl = this.defaultTTL) {
        this.cache.set(key, {
            value,
            expiry: Date.now() + ttl
        });
        this.stats.sets++;
    }

    delete(key) {
        const deleted = this.cache.delete(key);
        if (deleted) this.stats.deletes++;
        return deleted;
    }

    clear() {
        this.cache.clear();
    }

    getStats() {
        const total = this.stats.hits + this.stats.misses;
        return {
            ...this.stats,
            size: this.cache.size,
            hitRate: total > 0 ? (this.stats.hits / total * 100).toFixed(2) + '%' : '0%'
        };
    }

    cleanup() {
        const now = Date.now();
        for (const [key, item] of this.cache.entries()) {
            if (now > item.expiry) {
                this.cache.delete(key);
            }
        }
    }
}

const cache = new CacheManager();

// ==========================================
// 4. GESTIONNAIRE DE BASE DE DONNÉES ROBUSTE
// ==========================================
class DatabaseManager {
    constructor(filePath) {
        this.filePath = filePath;
        this.data = this.getDefaultStructure();
        this.saveTimeout = null;
        this.isSaving = false;
        this.saveQueue = [];
        this.backupInterval = null;
    }

    getDefaultStructure() {
        return {
            users: {},
            warnings: [],
            tickets: {},
            commands: {},
            tags: {},
            departments: {},
            settings: {},
            statistics: {
                totalMessages: 0,
                totalCommands: 0,
                totalMembers: 0
            }
        };
    }

    async init() {
        try {
            const content = await fs.readFile(this.filePath, 'utf8');
            this.data = JSON.parse(content);
            
            // Validation et migration des données
            this.migrateData();
            
            Logger.success('Base de données chargée avec succès.');
            
            // Démarrer les sauvegardes périodiques
            this.startAutoBackup();
        } catch (err) {
            if (err.code === 'ENOENT') {
                Logger.warn('Base de données introuvable. Création d\'une nouvelle instance.');
                await this.save();
                this.startAutoBackup();
            } else {
                Logger.error('Erreur lors du chargement de la base de données', err);
                throw err;
            }
        }
    }

    migrateData() {
        // Assurer que toutes les structures nécessaires existent
        const defaults = this.getDefaultStructure();
        for (const [key, defaultValue] of Object.entries(defaults)) {
            if (!(key in this.data)) {
                this.data[key] = defaultValue;
            }
        }
    }

    startAutoBackup() {
        if (this.backupInterval) {
            clearInterval(this.backupInterval);
        }
        
        this.backupInterval = setInterval(async () => {
            try {
                const backupPath = `${this.filePath}.backup`;
                await fs.copyFile(this.filePath, backupPath);
                Logger.debug('Sauvegarde automatique effectuée.');
            } catch (err) {
                Logger.error('Échec de la sauvegarde automatique', err);
            }
        }, CONFIG.database.backupInterval);
    }

    scheduleSave() {
        if (this.saveTimeout) clearTimeout(this.saveTimeout);
        this.saveTimeout = setTimeout(() => this.save(), CONFIG.database.saveDebounce);
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
            Logger.error('Échec de la sauvegarde de la base de données', err);
        } finally {
            this.isSaving = false;
            if (this.saveQueue.length > 0) {
                const nextSave = this.saveQueue.shift();
                nextSave();
            }
        }
    }

    // Méthodes Utilisateurs
    getUser(id) {
        return this.data.users[id] || null;
    }
    
    createUser(id, username) {
        this.data.users[id] = {
            discord_id: id,
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
        this.scheduleSave();
    }

    updateUserXP(id, xp, total_xp, level, last_xp) {
        if (this.data.users[id]) {
            Object.assign(this.data.users[id], { xp, total_xp, level, last_xp });
            this.scheduleSave();
        }
    }

    updateCoins(id, amount) {
        if (this.data.users[id]) {
            this.data.users[id].coins = amount;
            this.scheduleSave();
        }
    }

    addWarning(id) {
        if (this.data.users[id]) {
            this.data.users[id].warnings = (this.data.users[id].warnings || 0) + 1;
            this.scheduleSave();
        }
    }

    getTopUsers(limit = 10) {
        return Object.values(this.data.users)
            .sort((a, b) => (b.total_xp || 0) - (a.total_xp || 0))
            .slice(0, limit);
    }

    // Méthodes Tickets
    createTicket(channelId, userId) {
        this.data.tickets[channelId] = {
            channel_id: channelId,
            user_id: userId,
            status: 'open',
            created_at: new Date().toISOString()
        };
        this.scheduleSave();
    }

    closeTicket(channelId) {
        if (this.data.tickets[channelId]) {
            this.data.tickets[channelId].status = 'closed';
            this.data.tickets[channelId].closed_at = new Date().toISOString();
            this.scheduleSave();
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
        this.scheduleSave();
    }

    deleteCommand(name) {
        delete this.data.commands[name];
        this.scheduleSave();
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
        this.scheduleSave();
    }

    deleteTag(name) {
        delete this.data.tags[name];
        this.scheduleSave();
    }

    incrementTagUses(name) {
        if (this.data.tags[name]) {
            this.data.tags[name].uses++;
            this.scheduleSave();
        }
    }

    // Statistiques
    incrementStat(stat) {
        if (this.data.statistics[stat] !== undefined) {
            this.data.statistics[stat]++;
            this.scheduleSave();
        }
    }

    getStats() {
        return { ...this.data.statistics };
    }

    // Cleanup
    async destroy() {
        if (this.backupInterval) {
            clearInterval(this.backupInterval);
        }
        await this.save();
    }
}

const db = new DatabaseManager(CONFIG.database.path);

// ==========================================
// 5. REGISTRE DE COMMANDES AVANCÉ
// ==========================================
class CommandRegistry {
    constructor() {
        this.commands = new Collection();
        this.cooldowns = new Collection();
        this.aliases = new Collection();
    }

    register(command) {
        this.commands.set(command.name, command);
        
        if (command.aliases) {
            for (const alias of command.aliases) {
                this.aliases.set(alias, command.name);
            }
        }
        
        Logger.debug(`Commande enregistrée : ${command.name}`);
    }

    getCommand(nameOrAlias) {
        return this.commands.get(nameOrAlias) || 
               this.commands.get(this.aliases.get(nameOrAlias));
    }

    async executeSlash(interaction) {
        const command = this.commands.get(interaction.commandName);
        if (!command) {
            Logger.warn(`Commande slash inconnue : ${interaction.commandName}`);
            return;
        }

        await this._execute(command, interaction, null);
    }

    async executePrefix(message, args) {
        if (args.length === 0) return;

        const commandName = args[0].toLowerCase();
        const command = this.getCommand(commandName);
        
        if (!command || !command.prefixHandler) return;
        
        const mockInteraction = this.createMockInteraction(message, args, command);
        await this._execute(command, mockInteraction, message);
    }

    createMockInteraction(message, args, command) {
        return {
            commandName: command.name,
            user: message.author,
            member: message.member,
            guild: message.guild,
            channel: message.channel,
            options: {
                getMember: (name) => {
                    const mention = message.mentions.members.first();
                    if (mention) return mention;
                    const id = args[1];
                    if (id) {
                        return message.guild.members.cache.get(id) || 
                               message.guild.members.cache.find(m => 
                                   m.user.username.toLowerCase() === id.toLowerCase() ||
                                   m.displayName.toLowerCase() === id.toLowerCase()
                               );
                    }
                    return null;
                },
                getString: (name) => {
                    const index = this._getOptionIndex(command, name);
                    return args.slice(index).join(' ') || null;
                },
                getInteger: (name) => {
                    const index = this._getOptionIndex(command, name);
                    return parseInt(args[index]) || null;
                },
                getUser: (name) => {
                    const mention = message.mentions.users.first();
                    if (mention) return mention;
                    const id = args[1];
                    if (id) {
                        const member = message.guild.members.cache.get(id) || 
                                      message.guild.members.cache.find(m => 
                                          m.user.username.toLowerCase() === id.toLowerCase()
                                      );
                        return member?.user || null;
                    }
                    return null;
                }
            },
            reply: async (data) => {
                if (typeof data === 'string') {
                    await message.channel.send(data);
                } else if (data.embeds) {
                    await message.channel.send({ embeds: data.embeds });
                } else {
                    await message.channel.send(data);
                }
            },
            deferReply: async () => {},
            followUp: async (data) => {
                if (typeof data === 'string') {
                    await message.channel.send(data);
                } else if (data.embeds) {
                    await message.channel.send({ embeds: data.embeds });
                } else {
                    await message.channel.send(data);
                }
            }
        };
    }

    _getOptionIndex(command, optionName) {
        return 1;
    }

    async _execute(command, context, message) {
        try {
            // Vérification des permissions
            if (message && command.permissions) {
                const hasPermission = context.member.permissions.has(command.permissions);
                if (!hasPermission) {
                    return context.reply({
                        embeds: [new EmbedBuilder()
                            .setTitle('Permission Refusée')
                            .setDescription('Vous ne possédez pas les permissions requises pour exécuter cette commande.')
                            .setColor(CONFIG.colors.danger)]
                    });
                }
            }

            // Gestion des cooldowns
            if (command.cooldown) {
                if (!this.cooldowns.has(command.name)) {
                    this.cooldowns.set(command.name, new Collection());
                }

                const now = Date.now();
                const timestamps = this.cooldowns.get(command.name);
                const cooldownAmount = (command.cooldown || CONFIG.limits.commandCooldown) * 1000;

                if (timestamps.has(context.user.id)) {
                    const expirationTime = timestamps.get(context.user.id) + cooldownAmount;

                    if (now < expirationTime) {
                        const timeLeft = (expirationTime - now) / 1000;
                        return context.reply({
                            embeds: [new EmbedBuilder()
                                .setTitle('Cooldown Actif')
                                .setDescription(`Veuillez attendre **${timeLeft.toFixed(1)}** secondes avant de réutiliser cette commande.`)
                                .setColor(CONFIG.colors.warning)]
                        });
                    }
                }

                timestamps.set(context.user.id, now);
                setTimeout(() => timestamps.delete(context.user.id), cooldownAmount);
            }

            // Exécution de la commande
            await command.execute(context, bot.client, db);
            
            // Incrémenter les statistiques
            db.incrementStat('totalCommands');
            
            Logger.info(`Commande exécutée : ${context.commandName} par ${context.user.tag}`);
        } catch (error) {
            Logger.error(`Erreur lors de l'exécution de la commande ${context.commandName}`, error);

            const errorMsg = {
                embeds: [new EmbedBuilder()
                    .setTitle('Erreur Interne')
                    .setDescription('Une erreur inattendue s\'est produite lors du traitement de votre demande. Veuillez réessayer ultérieurement.')
                    .setColor(CONFIG.colors.danger)]
            };
            
            if (context.replied || context.deferred) {
                await context.followUp(errorMsg);
            } else {
                await context.reply(errorMsg);
            }
        }
    }

    getAllCommands() {
        return Array.from(this.commands.values());
    }

    getStats() {
        return {
            totalCommands: this.commands.size,
            cooldowns: this.cooldowns.size
        };
    }
}

const registry = new CommandRegistry();

// ==========================================
// 6. SERVICES MÉTIER
// ==========================================
class UserService {
    static async getUserOrCreate(id, username) {
        let user = db.getUser(id);
        if (!user) {
            db.createUser(id, username);
            user = db.getUser(id);
        }
        return user;
    }

    static async addXP(userId, amount) {
        const user = db.getUser(userId);
        if (!user) return null;

        const now = Date.now();
        if (now - user.last_xp < CONFIG.limits.xpCooldown) {
            return null;
        }

        let newXP = user.xp + amount;
        let newTotalXP = user.total_xp + amount;
        let newLevel = user.level;
        const xpNeeded = newLevel * 100 + (newLevel - 1) * 50;

        let leveledUp = false;
        if (newXP >= xpNeeded) {
            newXP -= xpNeeded;
            newLevel++;
            leveledUp = true;
        }

        db.updateUserXP(userId, newXP, newTotalXP, newLevel, now);
        
        return { level: newLevel, leveledUp };
    }

    static async getLeaderboard(limit = 10) {
        return db.getTopUsers(limit);
    }
}

class ModerationService {
    static async warnUser(targetId, moderatorId, reason) {
        await UserService.getUserOrCreate(targetId, 'Unknown');
        
        db.data.warnings.push({
            user_id: targetId,
            moderator_id: moderatorId,
            reason,
            created_at: new Date().toISOString()
        });
        
        db.addWarning(targetId);
        
        const user = db.getUser(targetId);
        return user.warnings;
    }

    static async getWarnings(userId) {
        return db.data.warnings
            .filter(w => w.user_id === userId)
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    }

    static async canModerate(moderator, target) {
        return moderator.roles.highest.position > target.roles.highest.position;
    }
}

class EconomyService {
    static async getBalance(userId) {
        const user = await UserService.getUserOrCreate(userId, 'Unknown');
        return {
            coins: user.coins,
            bank: user.bank,
            total: user.coins + user.bank
        };
    }

    static async addCoins(userId, amount) {
        const user = db.getUser(userId);
        if (!user) return false;
        
        db.updateCoins(userId, user.coins + amount);
        return true;
    }

    static async transferCoins(fromId, toId, amount) {
        const fromUser = db.getUser(fromId);
        const toUser = db.getUser(toId);
        
        if (!fromUser || !toUser) return false;
        if (fromUser.coins < amount) return false;
        
        db.updateCoins(fromId, fromUser.coins - amount);
        db.updateCoins(toId, toUser.coins + amount);
        
        return true;
    }

    static async claimDaily(userId) {
        const user = db.getUser(userId);
        if (!user) return null;

        const now = Date.now();
        if (user.last_daily && now - user.last_daily < CONFIG.limits.dailyCooldown) {
            const remaining = CONFIG.limits.dailyCooldown - (now - user.last_daily);
            return { success: false, remaining };
        }

        const reward = Math.floor(Math.random() * 100) + 50;
        db.updateCoins(userId, user.coins + reward);
        user.last_daily = now;
        db.scheduleSave();
        
        return { success: true, reward };
    }
}

class DepartmentService {
    static getDepartment(deptKey) {
        return CONFIG.departments[deptKey.toLowerCase()];
    }

    static isDirector(member, deptKey) {
        const dept = this.getDepartment(deptKey);
        if (!dept) return false;
        return member.roles.cache.has(dept.roles.director);
    }

    static async promoteMember(target, deptKey, gradeKey) {
        const dept = this.getDepartment(deptKey);
        if (!dept) return { success: false, error: 'Département invalide' };

        const targetRoleId = dept.roles[gradeKey.toLowerCase()];
        if (!targetRoleId) {
            return { success: false, error: 'Grade invalide' };
        }

        try {
            // Retirer les anciens rôles du département
            for (const roleId of Object.values(dept.roles)) {
                if (target.roles.cache.has(roleId)) {
                    await target.roles.remove(roleId);
                }
            }
            
            // Ajouter le nouveau rôle
            await target.roles.add(targetRoleId);
            
            return { success: true, grade: gradeKey };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }
}

// ==========================================
// 7. COMMANDES
// ==========================================
function setupCommands() {
    // --- PING ---
    registry.register({
        name: 'ping',
        slashData: new SlashCommandBuilder()
            .setName('ping')
            .setDescription('Vérifie la latence du bot.'),
        cooldown: 5,
        execute: async (ctx, client) => {
            await ctx.reply({
                embeds: [new EmbedBuilder()
                    .setTitle('Latence du Bot')
                    .setDescription(`Latence de l'API : **${client.ws.ping} ms**`)
                    .setColor(CONFIG.colors.primary)]
            });
        }
    });

    // --- BAN ---
    registry.register({
        name: 'ban',
        slashData: new SlashCommandBuilder()
            .setName('ban')
            .setDescription('Bannit un membre du serveur.')
            .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
            .addUserOption(o => o.setName('utilisateur').setDescription('L\'utilisateur à bannir').setRequired(true))
            .addStringOption(o => o.setName('raison').setDescription('Motif du bannissement').setRequired(true)),
        permissions: [PermissionFlagsBits.BanMembers],
        prefixHandler: true,
        cooldown: 10,
        execute: async (ctx, client) => {
            const target = ctx.options.getMember('utilisateur');
            const reason = ctx.options.getString('raison') || 'Aucun motif spécifié';

            if (!target) {
                return ctx.reply({
                    embeds: [new EmbedBuilder()
                        .setTitle('Erreur')
                        .setDescription('Utilisateur introuvable.')
                        .setColor(CONFIG.colors.danger)]
                });
            }

            if (target.id === ctx.user.id) {
                return ctx.reply({
                    embeds: [new EmbedBuilder()
                        .setTitle('Action Interdite')
                        .setDescription('Vous ne pouvez pas vous bannir vous-même.')
                        .setColor(CONFIG.colors.danger)]
                });
            }

            if (!await ModerationService.canModerate(ctx.member, target)) {
                return ctx.reply({
                    embeds: [new EmbedBuilder()
                        .setTitle('Permission Insuffisante')
                        .setDescription('Vous ne pouvez pas bannir un membre ayant un rôle supérieur ou égal au vôtre.')
                        .setColor(CONFIG.colors.danger)]
                });
            }

            try {
                await target.ban({ reason: `Banni par ${ctx.user.tag} : ${reason}` });
                
                await Logger.discord(
                    'Membre Banni',
                    `**${target.user.tag}** a été banni du serveur.`,
                    CONFIG.colors.danger,
                    [
                        { name: 'Modérateur', value: `${ctx.user.tag}`, inline: true },
                        { name: 'Motif', value: reason, inline: true }
                    ],
                    target.user.displayAvatarURL()
                );
                
                await ctx.reply({
                    embeds: [new EmbedBuilder()
                        .setTitle('Bannissement Réussi')
                        .setDescription(`${target.user.tag} a été banni avec succès.`)
                        .setColor(CONFIG.colors.success)]
                });
            } catch (error) {
                Logger.error('Échec du bannissement', error);
                await ctx.reply({
                    embeds: [new EmbedBuilder()
                        .setTitle('Erreur')
                        .setDescription(`Impossible de bannir ce membre : ${error.message}`)
                        .setColor(CONFIG.colors.danger)]
                });
            }
        }
    });

    // --- PROMOTE ---
    registry.register({
        name: 'promote',
        slashData: new SlashCommandBuilder()
            .setName('promote')
            .setDescription('Promouvoir un membre dans votre département.')
            .addUserOption(o => o.setName('utilisateur').setDescription('Le membre à promouvoir').setRequired(true))
            .addStringOption(o => o.setName('département').setDescription('Le département concerné').setRequired(true)
                .addChoices(
                    { name: 'SPVQ', value: 'spvq' },
                    { name: 'SPCIQ', value: 'spciq' },
                    { name: 'SQ', value: 'sq' }
                ))
            .addStringOption(o => o.setName('grade').setDescription('Le nouveau grade').setRequired(true)),
        permissions: [PermissionFlagsBits.ManageRoles],
        prefixHandler: true,
        cooldown: 5,
        execute: async (ctx) => {
            const target = ctx.options.getMember('utilisateur');
            const deptKey = ctx.options.getString('département')?.toLowerCase();
            const gradeKey = ctx.options.getString('grade')?.toLowerCase();

            if (!target) {
                return ctx.reply({
                    embeds: [new EmbedBuilder()
                        .setTitle('Erreur')
                        .setDescription('Membre introuvable.')
                        .setColor(CONFIG.colors.danger)]
                });
            }

            if (!DepartmentService.isDirector(ctx.member, deptKey)) {
                const dept = DepartmentService.getDepartment(deptKey);
                return ctx.reply({
                    embeds: [new EmbedBuilder()
                        .setTitle('Accès Refusé')
                        .setDescription(`Seul le directeur du ${dept?.name || 'département'} est autorisé à effectuer des promotions.`)
                        .setColor(CONFIG.colors.danger)]
                });
            }

            const result = await DepartmentService.promoteMember(target, deptKey, gradeKey);
            
            if (!result.success) {
                return ctx.reply({
                    embeds: [new EmbedBuilder()
                        .setTitle('Erreur')
                        .setDescription(result.error)
                        .setColor(CONFIG.colors.danger)]
                });
            }

            const dept = DepartmentService.getDepartment(deptKey);
            
            await Logger.discord(
                'Promotion Départementale',
                `**${target.user.tag}** a été promu au grade de **${gradeKey}** dans le **${dept.name}**.`,
                CONFIG.colors.success,
                [{ name: 'Promu par', value: `${ctx.user.tag}`, inline: true }],
                target.user.displayAvatarURL()
            );

            await ctx.reply({
                embeds: [new EmbedBuilder()
                    .setTitle('Promotion Réussie')
                    .setDescription(`${target.user.tag} a été promu avec succès au grade de **${gradeKey}** au sein du ${dept.name}.`)
                    .setColor(CONFIG.colors.success)]
            });
        }
    });

    // --- WARN ---
    registry.register({
        name: 'warn',
        slashData: new SlashCommandBuilder()
            .setName('warn')
            .setDescription('Avertit un membre.')
            .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
            .addUserOption(o => o.setName('membre').setDescription('Le membre à avertir').setRequired(true))
            .addStringOption(o => o.setName('raison').setDescription('Motif de l\'avertissement').setRequired(true)),
        permissions: [PermissionFlagsBits.ModerateMembers],
        prefixHandler: true,
        cooldown: 5,
        execute: async (ctx) => {
            const target = ctx.options.getUser('membre');
            const reason = ctx.options.getString('raison') || 'Aucun motif spécifié';

            const warnCount = await ModerationService.warnUser(target.id, ctx.user.id, reason);
            
            await Logger.discord(
                'Avertissement Émis',
                `**${ctx.user.tag}** a averti **${target.tag}**.`,
                CONFIG.colors.warning,
                [{ name: 'Motif', value: reason, inline: false }],
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

    // --- SCAN (10 fichiers équilibrés) ---
    registry.register({
        name: 'scan',
        slashData: new SlashCommandBuilder()
            .setName('scan')
            .setDescription('Analyse complète du serveur et génération de 10 fichiers JSON équilibrés.'),
        cooldown: 60,
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
                        topic: ch.topic
                    });
                });

                guild.roles.cache.forEach(role => {
                    items.push({
                        _type: 'role',
                        id: role.id,
                        name: role.name,
                        color: role.hexColor,
                        position: role.position,
                        permissions: role.permissions.toArray()
                    });
                });

                guild.members.cache.forEach(m => {
                    items.push({
                        _type: 'member',
                        id: m.id,
                        username: m.user.username,
                        displayName: m.displayName,
                        roles: m.roles.cache.filter(r => r.id !== guild.id).map(r => r.name),
                        joinedAt: m.joinedAt?.toISOString()
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
                const safeName = guild.name.replace(/\s+/g, '_');
                
                for (let i = 0; i < numFiles; i++) {
                    const metaData = {
                        _meta: {
                            file: i + 1,
                            total_files: numFiles,
                            server: guild.name,
                            timestamp: new Date().toISOString(),
                            item_count: buckets[i].items.length,
                            size_kb: Math.round(buckets[i].size / 1024)
                        },
                        data: buckets[i].items
                    };

                    files.push({
                        attachment: Buffer.from(JSON.stringify(metaData, null, 2), 'utf-8'),
                        name: `scan_partie_${String(i + 1).padStart(2, '0')}_sur_${numFiles}_${safeName}_${timestamp}.json`
                    });
                }

                await ctx.followUp({
                    embeds: [new EmbedBuilder()
                        .setTitle('Analyse Terminée')
                        .setDescription(`L'analyse a généré **${numFiles} fichiers JSON** contenant l'intégralité des données du serveur.\n\n**Taille moyenne :** ${Math.round(avgSize / 1024)} KB par fichier.`)
                        .setColor(CONFIG.colors.success)
                        .setTimestamp()],
                    files: files,
                    ephemeral: true
                });

                await Logger.discord(
                    'Analyse du Serveur',
                    `**${ctx.user.tag}** a effectué une analyse complète du serveur.`,
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
                        .setTitle('Erreur')
                        .setDescription(`Une erreur s'est produite : ${error.message}`)
                        .setColor(CONFIG.colors.danger)],
                    ephemeral: true
                });
            }
        }
    });

    // ... (autres commandes: clear, ticket, userinfo, etc.)
}

// ==========================================
// 8. CLASSE PRINCIPALE DU BOT
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
    }

    setupExpress() {
        this.expressApp.use(helmet());
        this.expressApp.use(compression());
        this.expressApp.use(express.json());
        
        const limiter = rateLimit({
            windowMs: 15 * 60 * 1000,
            max: CONFIG.limits.apiRateLimit
        });
        this.expressApp.use(limiter);

        this.expressApp.get('/', (req, res) => {
            const uptime = Math.floor((Date.now() - this.startTime) / 1000);
            res.status(200).json({
                status: 'online',
                name: CONFIG.server.name,
                uptime,
                version: '8.0.0',
                cache: cache.getStats(),
                database: {
                    users: Object.keys(db.data.users).length,
                    commands: Object.keys(db.data.commands).length
                }
            });
        });

        this.expressApp.get('/api/stats', (req, res) => {
            const guild = this.client.guilds.cache.get(CONFIG.server.id);
            if (!guild) return res.status(404).json({ error: 'Serveur introuvable.' });

            const onlineCount = guild.members.cache.filter(m => 
                !m.user.bot && m.presence?.status !== 'offline'
            ).size;

            res.json({
                totalMembers: guild.memberCount,
                onlineMembers: onlineCount,
                botPing: this.client.ws.ping,
                uptime: Math.floor((Date.now() - this.startTime) / 1000)
            });
        });

        this.expressApp.get('/api/health', (req, res) => {
            res.status(200).json({
                status: 'healthy',
                uptime: Math.floor((Date.now() - this.startTime) / 1000),
                memory: process.memoryUsage(),
                cache: cache.getStats()
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
            
            this.client.user.setPresence({
                activities: [{ name: 'Ville de Québec Roleplay', type: ActivityType.Watching }],
                status: 'online'
            });
            
            await Logger.discord(
                'Système Démarré',
                `Le bot est désormais opérationnel.`,
                CONFIG.colors.success,
                [],
                this.client.user.displayAvatarURL()
            );
            
            try {
                const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
                await rest.put(
                    Routes.applicationGuildCommands(this.client.user.id, CONFIG.server.id),
                    { body: Array.from(registry.commands.values()).map(cmd => cmd.slashData.toJSON()) }
                );
                Logger.success('Commandes slash enregistrées avec succès.');
            } catch (error) {
                Logger.error('Échec de l\'enregistrement des commandes', error);
            }
        });

        this.client.on('messageCreate', async (message) => {
            if (message.author.bot || message.guild?.id !== CONFIG.server.id) return;

            db.incrementStat('totalMessages');

            if (message.content.startsWith(CONFIG.prefix)) {
                const args = message.content.slice(CONFIG.prefix.length).trim().split(/ +/);
                await registry.executePrefix(message, args);
                return;
            }

            await UserService.getUserOrCreate(message.author.id, message.author.tag);
            const xpResult = await UserService.addXP(message.author.id, Math.floor(Math.random() * 15) + 10);
            
            if (xpResult?.leveledUp) {
                message.reply({
                    embeds: [new EmbedBuilder()
                        .setTitle('Niveau Supérieur')
                        .setDescription(`Félicitations ${message.author}, vous êtes passé au niveau **${xpResult.level}**.`)
                        .setColor(CONFIG.colors.success)]
                }).catch(() => {});
            }
        });

        this.client.on('interactionCreate', async (interaction) => {
            if (interaction.isChatInputCommand()) {
                await registry.executeSlash(interaction);
            }
        });

        process.on('SIGINT', () => this.shutdown());
        process.on('SIGTERM', () => this.shutdown());
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
            
            Logger.info('Configuration des commandes...');
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
// 9. INITIALISATION
// ==========================================
const bot = new VQCBot();
bot.start().catch(err => {
    Logger.fatal('Erreur fatale', err);
    process.exit(1);
});
