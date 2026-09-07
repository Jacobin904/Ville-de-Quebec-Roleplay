/**
 * VQC Discord Bot - Enterprise Edition
 * Architecture modulaire avec gestion d'erreurs avancée
 * Version: 7.0.0 (Production Ready)
 * 
 * @author Jacobin Babouain
 * @description Bot Discord professionnel pour Ville de Québec Roleplay
 */

require('dotenv').config();
const fs = require('fs').promises;
const path = require('path');
const express = require('express');
const { 
    Client, GatewayIntentBits, EmbedBuilder, SlashCommandBuilder, 
    REST, Routes, ChannelType, PermissionFlagsBits, Collection, ActivityType,
    ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle
} = require('discord.js');

// ==========================================
// 1. CONFIGURATION CENTRALISÉE
// ==========================================
const CONFIG = {
    prefix: '.',
    server: {
        id: process.env.GUILD_ID || '1490410149213507804',
        name: 'Ville de Québec Roleplay',
        icon: 'https://cdn.discordapp.com/icons/1490410149213507804/0b1aa46a2fdb33b133a0feb1234739f6.webp?size=1024'
    },
    channels: {
        logs: '1538659168012075029'
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
        scanFiles: 10
    },
    departments: {
        spvq: {
            name: 'Service de Police (SPVQ)',
            roles: {
                director: 'ID_ROLE_DIRECTEUR_SPVQ',
                manager: 'ID_ROLE_MANAGER_SPVQ',
                agent: 'ID_ROLE_AGENT_SPVQ',
                recruit: 'ID_ROLE_RECRUE_SPVQ'
            }
        },
        spciq: {
            name: 'Service Incendie (SPCIQ)',
            roles: {
                director: 'ID_ROLE_DIRECTEUR_SPCIQ',
                manager: 'ID_ROLE_MANAGER_SPCIQ',
                firefighter: 'ID_ROLE_POMPIER_SPCIQ',
                recruit: 'ID_ROLE_RECRUE_SPCIQ'
            }
        },
        sq: {
            name: 'Sûreté du Québec (SQ)',
            roles: {
                director: 'ID_ROLE_DIRECTEUR_SQ',
                manager: 'ID_ROLE_MANAGER_SQ',
                agent: 'ID_ROLE_AGENT_SQ',
                recruit: 'ID_ROLE_RECRUE_SQ'
            }
        }
    }
};

// ==========================================
// 2. SYSTÈME DE JOURNALISATION AVANCÉ
// ==========================================
class Logger {
    static levels = {
        DEBUG: 0,
        INFO: 1,
        WARN: 2,
        ERROR: 3,
        FATAL: 4
    };

    static currentLevel = Logger.levels.INFO;

    static format(level, message) {
        const timestamp = new Date().toLocaleString('fr-CA', { 
            timeZone: 'America/Toronto',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
        return `[${timestamp}] [${level}] ${message}`;
    }

    static debug(msg) {
        if (Logger.currentLevel <= Logger.levels.DEBUG) {
            console.log(Logger.format('DEBUG', msg));
        }
    }

    static info(msg) {
        if (Logger.currentLevel <= Logger.levels.INFO) {
            console.log(Logger.format('INFO', msg));
        }
    }

    static warn(msg) {
        if (Logger.currentLevel <= Logger.levels.WARN) {
            console.warn(Logger.format('WARN', msg));
        }
    }

    static error(msg) {
        if (Logger.currentLevel <= Logger.levels.ERROR) {
            console.error(Logger.format('ERROR', msg));
        }
    }

    static fatal(msg) {
        console.error(Logger.format('FATAL', msg));
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
                    Logger.error(`Échec de l'envoi du journal Discord : ${err.message}`);
                });
            }
        } catch (err) {
            Logger.error(`Erreur dans le système de journalisation Discord : ${err.message}`);
        }
    }
}

// ==========================================
// 3. GESTIONNAIRE DE BASE DE DONNÉES ROBUSTE
// ==========================================
class DatabaseManager {
    constructor(filePath) {
        this.filePath = filePath;
        this.data = {
            users: {},
            warnings: [],
            tickets: {},
            commands: {},
            tags: {},
            departments: {}
        };
        this.saveTimeout = null;
        this.isSaving = false;
        this.saveQueue = [];
        this.cache = new Map();
        this.cacheTimeout = 60000; // 1 minute
    }

    async init() {
        try {
            const content = await fs.readFile(this.filePath, 'utf8');
            this.data = JSON.parse(content);
            Logger.success('Base de données chargée avec succès.');
            
            // Validation de l'intégrité des données
            this.validateData();
        } catch (err) {
            if (err.code === 'ENOENT') {
                Logger.warn('Base de données introuvable. Création d\'une nouvelle instance.');
                await this.save();
            } else {
                Logger.error(`Erreur lors du chargement de la base de données : ${err.message}`);
                throw err;
            }
        }
    }

    validateData() {
        // S'assurer que toutes les structures nécessaires existent
        if (!this.data.users) this.data.users = {};
        if (!this.data.warnings) this.data.warnings = [];
        if (!this.data.tickets) this.data.tickets = {};
        if (!this.data.commands) this.data.commands = {};
        if (!this.data.tags) this.data.tags = {};
    }

    scheduleSave() {
        if (this.saveTimeout) clearTimeout(this.saveTimeout);
        this.saveTimeout = setTimeout(() => this.save(), 3000);
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
            Logger.error(`Échec de la sauvegarde de la base de données : ${err.message}`);
        } finally {
            this.isSaving = false;
            if (this.saveQueue.length > 0) {
                const nextSave = this.saveQueue.shift();
                nextSave();
            }
        }
    }

    // Méthodes Utilisateurs avec cache
    getUser(id) {
        const cacheKey = `user_${id}`;
        if (this.cache.has(cacheKey)) {
            const cached = this.cache.get(cacheKey);
            if (Date.now() - cached.timestamp < this.cacheTimeout) {
                return cached.data;
            }
        }

        const user = this.data.users[id] || null;
        if (user) {
            this.cache.set(cacheKey, { data: user, timestamp: Date.now() });
        }
        return user;
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
        this.cache.delete(`user_${id}`);
        this.scheduleSave();
    }

    updateUserXP(id, xp, total_xp, level, last_xp) {
        if (this.data.users[id]) {
            Object.assign(this.data.users[id], { xp, total_xp, level, last_xp });
            this.cache.delete(`user_${id}`);
            this.scheduleSave();
        }
    }

    updateCoins(id, amount) {
        if (this.data.users[id]) {
            this.data.users[id].coins = amount;
            this.cache.delete(`user_${id}`);
            this.scheduleSave();
        }
    }

    addWarning(id) {
        if (this.data.users[id]) {
            this.data.users[id].warnings = (this.data.users[id].warnings || 0) + 1;
            this.cache.delete(`user_${id}`);
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
}

const db = new DatabaseManager(path.join(__dirname, 'vqc_data.json'));

// ==========================================
// 4. REGISTRE DE COMMANDES UNIFIÉ
// ==========================================
class CommandRegistry {
    constructor() {
        this.commands = new Collection();
        this.cooldowns = new Collection();
    }

    register(command) {
        this.commands.set(command.name, command);
        Logger.debug(`Commande enregistrée : ${command.name}`);
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
        const command = this.commands.get(commandName);
        
        if (!command || !command.prefixHandler) return;
        
        // Simulation d'un objet interaction pour la réutilisation du code
        const mockInteraction = {
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
                               message.guild.members.cache.find(m => m.user.username.toLowerCase() === id.toLowerCase());
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
                                      message.guild.members.cache.find(m => m.user.username.toLowerCase() === id.toLowerCase());
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
        
        await this._execute(command, mockInteraction, message);
    }

    _getOptionIndex(command, optionName) {
        // Trouver l'index de l'option dans les arguments
        // C'est une simplification - dans un vrai système, il faudrait parser les options
        return 1; // Par défaut, les options commencent à l'index 1
    }

    async _execute(command, context, message) {
        try {
            // Vérification des permissions pour les commandes préfixées
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
                const cooldownAmount = (command.cooldown || 3) * 1000;

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
            Logger.info(`Commande exécutée : ${context.commandName} par ${context.user.tag}`);
        } catch (error) {
            Logger.error(`Erreur lors de l'exécution de la commande ${context.commandName} : ${error.message}`);
            Logger.error(error.stack);

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
}

const registry = new CommandRegistry();

// ==========================================
// 5. DÉFINITION DES COMMANDES
// ==========================================
function setupCommands() {
    // --- COMMANDE : PING ---
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

    // --- COMMANDE : BAN ---
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
        execute: async (ctx, client, database) => {
            const target = ctx.options.getMember('utilisateur');
            const reason = ctx.options.getString('raison') || 'Aucun motif spécifié';

            if (!target) {
                return ctx.reply({
                    embeds: [new EmbedBuilder()
                        .setTitle('Erreur')
                        .setDescription('Utilisateur introuvable. Veuillez vérifier l\'identifiant ou la mention.')
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

            if (ctx.member.roles.highest.position <= target.roles.highest.position) {
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
                        { name: 'Modérateur', value: `${ctx.user.tag} (${ctx.user.id})`, inline: true },
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
                Logger.error(`Échec du bannissement : ${error.message}`);
                await ctx.reply({
                    embeds: [new EmbedBuilder()
                        .setTitle('Erreur')
                        .setDescription(`Impossible de bannir ce membre : ${error.message}`)
                        .setColor(CONFIG.colors.danger)]
                });
            }
        }
    });

    // --- COMMANDE : PROMOTE (Promotion Départementale) ---
    registry.register({
        name: 'promote',
        slashData: new SlashCommandBuilder()
            .setName('promote')
            .setDescription('Promouvoir un membre dans votre département (Réservé aux directeurs).')
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
        execute: async (ctx, client, database) => {
            const target = ctx.options.getMember('utilisateur');
            const deptKey = ctx.options.getString('département')?.toLowerCase();
            const newGradeKey = ctx.options.getString('grade')?.toLowerCase();

            if (!target) {
                return ctx.reply({
                    embeds: [new EmbedBuilder()
                        .setTitle('Erreur')
                        .setDescription('Membre introuvable.')
                        .setColor(CONFIG.colors.danger)]
                });
            }

            const dept = CONFIG.departments[deptKey];
            if (!dept) {
                return ctx.reply({
                    embeds: [new EmbedBuilder()
                        .setTitle('Département Invalide')
                        .setDescription('Département invalide. Choisissez parmi : spvq, spciq, sq.')
                        .setColor(CONFIG.colors.danger)]
                });
            }

            // Vérifier si l'exécutant est le directeur de ce département
            if (!ctx.member.roles.cache.has(dept.roles.director)) {
                return ctx.reply({
                    embeds: [new EmbedBuilder()
                        .setTitle('Accès Refusé')
                        .setDescription(`Seul le directeur du ${dept.name} est autorisé à effectuer des promotions.`)
                        .setColor(CONFIG.colors.danger)]
                });
            }

            // Vérifier si le nouveau grade existe
            const targetRoleId = dept.roles[newGradeKey];
            if (!targetRoleId) {
                const validGrades = Object.keys(dept.roles).join(', ');
                return ctx.reply({
                    embeds: [new EmbedBuilder()
                        .setTitle('Grade Invalide')
                        .setDescription(`Grade invalide. Grades disponibles pour ce département : ${validGrades}.`)
                        .setColor(CONFIG.colors.danger)]
                });
            }

            try {
                // Retirer les anciens rôles de département
                for (const roleId of Object.values(dept.roles)) {
                    if (target.roles.cache.has(roleId)) {
                        await target.roles.remove(roleId);
                    }
                }
                
                // Ajouter le nouveau rôle
                await target.roles.add(targetRoleId);
                
                await Logger.discord(
                    'Promotion Départementale',
                    `**${target.user.tag}** a été promu au grade de **${newGradeKey}** dans le **${dept.name}**.`,
                    CONFIG.colors.success,
                    [
                        { name: 'Promu par', value: `${ctx.user.tag}`, inline: true }
                    ],
                    target.user.displayAvatarURL()
                );

                await ctx.reply({
                    embeds: [new EmbedBuilder()
                        .setTitle('Promotion Réussie')
                        .setDescription(`${target.user.tag} a été promu avec succès au grade de **${newGradeKey}** au sein du ${dept.name}.`)
                        .setColor(CONFIG.colors.success)]
                });
            } catch (error) {
                Logger.error(`Échec de la promotion : ${error.message}`);
                await ctx.reply({
                    embeds: [new EmbedBuilder()
                        .setTitle('Erreur')
                        .setDescription(`Échec de la modification des rôles : ${error.message}`)
                        .setColor(CONFIG.colors.danger)]
                });
            }
        }
    });

    // --- COMMANDE : WARN ---
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
        execute: async (ctx, client, database) => {
            const target = ctx.options.getUser('membre');
            const reason = ctx.options.getString('raison') || 'Aucun motif spécifié';

            if (!database.getUser(target.id)) {
                database.createUser(target.id, target.tag);
            }
            
            database.data.warnings.push({
                user_id: target.id,
                moderator_id: ctx.user.id,
                reason,
                created_at: new Date().toISOString()
            });
            database.addWarning(target.id);
            
            await Logger.discord(
                'Avertissement Émis',
                `**${ctx.user.tag}** a averti **${target.tag}**.`,
                CONFIG.colors.warning,
                [
                    { name: 'Motif', value: reason, inline: false }
                ],
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
            
            const updated = database.getUser(target.id);
            await ctx.reply({
                embeds: [new EmbedBuilder()
                    .setTitle('Avertissement Enregistré')
                    .setDescription(`${target.tag} a été averti.\n\n**Total des avertissements :** ${updated.warnings}`)
                    .setColor(CONFIG.colors.success)]
            });
        }
    });

    // --- COMMANDE : CLEAR ---
    registry.register({
        name: 'clear',
        slashData: new SlashCommandBuilder()
            .setName('clear')
            .setDescription('Supprime des messages.')
            .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
            .addIntegerOption(o => o.setName('nombre').setDescription('Nombre de messages à supprimer (max 100)').setRequired(true).setMinValue(1).setMaxValue(100)),
        permissions: [PermissionFlagsBits.ManageMessages],
        prefixHandler: true,
        cooldown: 10,
        execute: async (ctx, client, database) => {
            const amount = ctx.options.getInteger('nombre');
            
            try {
                await ctx.channel.bulkDelete(amount, true);
                await ctx.reply({
                    embeds: [new EmbedBuilder()
                        .setTitle('Messages Supprimés')
                        .setDescription(`${amount} messages ont été supprimés avec succès.`)
                        .setColor(CONFIG.colors.success)]
                });
                
                await Logger.discord(
                    'Messages Supprimés',
                    `**${ctx.user.tag}** a supprimé **${amount}** messages dans le salon <#${ctx.channel.id}>.`,
                    CONFIG.colors.warning,
                    [],
                    ctx.user.displayAvatarURL()
                );
            } catch (error) {
                Logger.error(`Échec de la suppression des messages : ${error.message}`);
                await ctx.reply({
                    embeds: [new EmbedBuilder()
                        .setTitle('Erreur')
                        .setDescription(`Impossible de supprimer les messages : ${error.message}`)
                        .setColor(CONFIG.colors.danger)]
                });
            }
        }
    });

    // --- COMMANDE : TICKET ---
    registry.register({
        name: 'ticket',
        slashData: new SlashCommandBuilder()
            .setName('ticket')
            .setDescription('Ouvre un ticket de support.'),
        cooldown: 30,
        execute: async (ctx, client, database) => {
            if (ctx.channel?.send) {
                const guild = ctx.guild;
                
                try {
                    const ticketChannel = await guild.channels.create({
                        name: `ticket-${ctx.user.username.toLowerCase()}`,
                        type: ChannelType.GuildText,
                        permissionOverwrites: [
                            { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                            { id: ctx.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }
                        ]
                    });
                    
                    database.createTicket(ticketChannel.id, ctx.user.id);
                    
                    await ticketChannel.send({
                        content: `${ctx.user}`,
                        embeds: [new EmbedBuilder()
                            .setTitle('Nouveau Ticket de Support')
                            .setDescription('Un membre de l\'équipe de direction va prendre en charge votre demande dans les plus brefs délais.\n\nVeuillez décrire votre problème en détail.')
                            .setColor(CONFIG.colors.primary)
                            .setTimestamp()]
                    });
                    
                    await ctx.reply({
                        embeds: [new EmbedBuilder()
                            .setTitle('Ticket Créé')
                            .setDescription(`Votre ticket a été créé avec succès : ${ticketChannel}`)
                            .setColor(CONFIG.colors.success)]
                    });
                    
                    await Logger.discord(
                        'Ticket Créé',
                        `**${ctx.user.tag}** a ouvert un ticket : <#${ticketChannel.id}>`,
                        CONFIG.colors.info,
                        [],
                        ctx.user.displayAvatarURL()
                    );
                } catch (error) {
                    Logger.error(`Échec de la création du ticket : ${error.message}`);
                    await ctx.reply({
                        embeds: [new EmbedBuilder()
                            .setTitle('Erreur')
                            .setDescription(`Impossible de créer le ticket : ${error.message}`)
                            .setColor(CONFIG.colors.danger)]
                    });
                }
            }
        }
    });

    // --- COMMANDE : USERINFO ---
    registry.register({
        name: 'userinfo',
        slashData: new SlashCommandBuilder()
            .setName('userinfo')
            .setDescription('Affiche les informations détaillées d\'un utilisateur.')
            .addUserOption(o => o.setName('membre').setDescription('Le membre concerné')),
        cooldown: 5,
        execute: async (ctx, client, database) => {
            const target = ctx.options.getMember('membre') || ctx.member;
            const roles = target.roles.cache.filter(r => r.id !== ctx.guild.id).map(r => r.name).join(', ') || 'Aucun';
            
            await ctx.reply({
                embeds: [new EmbedBuilder()
                    .setTitle(`Informations : ${target.user.username}`)
                    .setColor(CONFIG.colors.primary)
                    .setThumbnail(target.user.displayAvatarURL())
                    .addFields(
                        { name: 'Pseudonyme', value: target.displayName, inline: true },
                        { name: 'Identifiant', value: target.id, inline: true },
                        { name: 'Compte créé le', value: `<t:${Math.floor(target.user.createdTimestamp / 1000)}:D>`, inline: true },
                        { name: 'Rôles', value: roles.substring(0, 1000), inline: false }
                    )
                    .setFooter({ text: CONFIG.server.name, iconURL: CONFIG.server.icon })
                    .setTimestamp()]
            });
        }
    });

    // --- COMMANDE : SCAN (Optimisée pour 10 fichiers) ---
    registry.register({
        name: 'scan',
        slashData: new SlashCommandBuilder()
            .setName('scan')
            .setDescription('Analyse complète du serveur et génération de 10 fichiers JSON équilibrés.'),
        cooldown: 60,
        execute: async (ctx, client, database) => {
            await ctx.deferReply({ ephemeral: true });
            
            try {
                const guild = ctx.guild;
                Logger.info(`Démarrage de l'analyse du serveur ${guild.name} (${guild.id})`);
                
                // Collecte de toutes les données
                const items = [];
                
                // Informations du serveur
                items.push({
                    _type: 'server_info',
                    id: guild.id,
                    name: guild.name,
                    ownerId: guild.ownerId,
                    memberCount: guild.memberCount,
                    createdAt: guild.createdAt.toISOString(),
                    description: guild.description,
                    iconURL: guild.iconURL(),
                    bannerURL: guild.bannerURL(),
                    features: guild.features,
                    verificationLevel: guild.verificationLevel,
                    explicitContentFilter: guild.explicitContentFilter,
                    mfaLevel: guild.mfaLevel
                });

                // Channels
                guild.channels.cache.forEach(ch => {
                    items.push({
                        _type: 'channel',
                        id: ch.id,
                        name: ch.name,
                        type: ChannelType[ch.type],
                        parentId: ch.parentId,
                        position: ch.position,
                        topic: ch.topic,
                        nsfw: ch.nsfw,
                        rateLimitPerUser: ch.rateLimitPerUser,
                        createdAt: ch.createdAt?.toISOString()
                    });
                });

                // Rôles
                guild.roles.cache.forEach(role => {
                    items.push({
                        _type: 'role',
                        id: role.id,
                        name: role.name,
                        color: role.hexColor,
                        position: role.position,
                        permissions: role.permissions.toArray(),
                        hoist: role.hoist,
                        mentionable: role.mentionable,
                        managed: role.managed,
                        createdAt: role.createdAt?.toISOString()
                    });
                });

                // Membres
                guild.members.cache.forEach(m => {
                    items.push({
                        _type: 'member',
                        id: m.id,
                        username: m.user.username,
                        displayName: m.displayName,
                        discriminator: m.user.discriminator,
                        avatar: m.user.avatar,
                        roles: m.roles.cache.filter(r => r.id !== guild.id).map(r => ({ id: r.id, name: r.name })),
                        joinedAt: m.joinedAt?.toISOString(),
                        premiumSince: m.premiumSince?.toISOString(),
                        pending: m.pending
                    });
                });

                // Émojis
                guild.emojis.cache.forEach(emoji => {
                    items.push({
                        _type: 'emoji',
                        id: emoji.id,
                        name: emoji.name,
                        animated: emoji.animated,
                        available: emoji.available,
                        url: emoji.url
                    });
                });

                Logger.info(`Collecte terminée : ${items.length} éléments à analyser`);

                // Tri par taille pour un équilibrage optimal
                items.sort((a, b) => JSON.stringify(b).length - JSON.stringify(a).length);

                // Algorithme de bin packing équilibré pour 10 fichiers
                const numFiles = CONFIG.limits.scanFiles;
                const buckets = Array.from({ length: numFiles }, () => ({ items: [], size: 0 }));
                
                for (const item of items) {
                    const itemSize = JSON.stringify(item).length;
                    // Trouver le seau le plus léger
                    const smallestBucket = buckets.reduce((prev, curr) => 
                        prev.size < curr.size ? prev : curr
                    );
                    smallestBucket.items.push(item);
                    smallestBucket.size += itemSize;
                }

                // Calcul des statistiques
                const totalSize = buckets.reduce((sum, b) => sum + b.size, 0);
                const avgSize = totalSize / numFiles;
                const maxSize = Math.max(...buckets.map(b => b.size));
                const minSize = Math.min(...buckets.map(b => b.size));

                Logger.info(`Répartition : Taille moyenne ${Math.round(avgSize / 1024)} KB, Max ${Math.round(maxSize / 1024)} KB, Min ${Math.round(minSize / 1024)} KB`);

                // Génération des fichiers
                const files = [];
                const timestamp = Date.now();
                const safeName = guild.name.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '');
                
                for (let i = 0; i < numFiles; i++) {
                    const bucket = buckets[i];
                    const metaData = {
                        _meta: {
                            file: i + 1,
                            total_files: numFiles,
                            server: guild.name,
                            server_id: guild.id,
                            timestamp: new Date().toISOString(),
                            item_count: bucket.items.length,
                            size_bytes: bucket.size,
                            size_kb: Math.round(bucket.size / 1024),
                            average_size_kb: Math.round(avgSize / 1024)
                        },
                        data: bucket.items
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
                        .setDescription(`L'analyse a généré **${numFiles} fichiers JSON** contenant l'intégralité des données du serveur.\n\n**Statistiques :**\n• Taille moyenne : ${Math.round(avgSize / 1024)} KB\n• Taille maximale : ${Math.round(maxSize / 1024)} KB\n• Taille minimale : ${Math.round(minSize / 1024)} KB\n• Écart type : ${Math.round((maxSize - minSize) / 1024)} KB`)
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
                Logger.error(`Échec de l'analyse : ${error.message}`);
                Logger.error(error.stack);
                
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
// 6. CLASSE PRINCIPALE DU BOT
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
        this.expressApp.use(express.json());
        this.expressApp.use((req, res, next) => {
            res.header('Access-Control-Allow-Origin', '*');
            res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
            next();
        });

        // Health check endpoint
        this.expressApp.get('/', (req, res) => {
            const uptime = Math.floor((Date.now() - this.startTime) / 1000);
            res.status(200).json({
                status: 'online',
                name: CONFIG.server.name,
                uptime: uptime,
                members: this.client.guilds.cache.get(CONFIG.server.id)?.memberCount || 0,
                version: '7.0.0'
            });
        });

        // API endpoint pour les statistiques
        this.expressApp.get('/api/stats', (req, res) => {
            const guild = this.client.guilds.cache.get(CONFIG.server.id);
            if (!guild) {
                return res.status(404).json({ error: 'Serveur introuvable.' });
            }

            const onlineCount = guild.members.cache.filter(m => 
                !m.user.bot && m.presence?.status !== 'offline'
            ).size;

            const uptime = Math.floor((Date.now() - this.startTime) / 1000);

            res.json({
                totalMembers: guild.memberCount,
                onlineMembers: onlineCount,
                botPing: this.client.ws.ping,
                uptime: uptime
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
                    { body: Array.from(registry.commands.values()).map(cmd => cmd.slashData.toJSON()) }
                );
                Logger.success('Commandes slash enregistrées avec succès.');
            } catch (error) {
                Logger.error(`Échec de l'enregistrement des commandes : ${error.message}`);
                Logger.error(error.stack);
            }
        });

        this.client.on('guildMemberAdd', async (member) => {
            if (member.guild.id !== CONFIG.server.id) return;
            
            if (!db.getUser(member.id)) {
                db.createUser(member.id, member.user.tag);
            }
            
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

        this.client.on('messageCreate', async (message) => {
            if (message.author.bot || message.guild?.id !== CONFIG.server.id) return;

            // Gestion des commandes préfixées
            if (message.content.startsWith(CONFIG.prefix)) {
                const args = message.content.slice(CONFIG.prefix.length).trim().split(/ +/);
                await registry.executePrefix(message, args);
                return;
            }

            // Système de niveaux (XP)
            if (!db.getUser(message.author.id)) {
                db.createUser(message.author.id, message.author.tag);
            }

            const user = db.getUser(message.author.id);
            const now = Date.now();
            
            if (now - user.last_xp > CONFIG.limits.xpCooldown) {
                const xpGain = Math.floor(Math.random() * 15) + 10;
                let newXP = user.xp + xpGain;
                let newTotalXP = user.total_xp + xpGain;
                let newLevel = user.level;
                const xpNeeded = newLevel * 100 + (newLevel - 1) * 50;

                if (newXP >= xpNeeded) {
                    newXP -= xpNeeded;
                    newLevel++;
                    
                    message.reply({
                        embeds: [new EmbedBuilder()
                            .setTitle('Niveau Supérieur')
                            .setDescription(`Félicitations ${message.author}, vous êtes passé au niveau **${newLevel}**.`)
                            .setColor(CONFIG.colors.success)]
                    }).catch(() => {});
                }
                
                db.updateUserXP(message.author.id, newXP, newTotalXP, newLevel, now);
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
        });

        this.client.on('interactionCreate', async (interaction) => {
            if (interaction.isChatInputCommand()) {
                await registry.executeSlash(interaction);
            } else if (interaction.isButton()) {
                if (interaction.customId === 'close_ticket') {
                    if (!interaction.channel.name.startsWith('ticket-')) {
                        return interaction.reply({
                            embeds: [new EmbedBuilder()
                                .setTitle('Erreur')
                                .setDescription('Cette action n\'est disponible que dans un salon de ticket.')
                                .setColor(CONFIG.colors.danger)],
                            ephemeral: true
                        });
                    }
                    
                    db.closeTicket(interaction.channel.id);
                    
                    await interaction.reply({
                        embeds: [new EmbedBuilder()
                            .setTitle('Fermeture en Cours')
                            .setDescription('Le ticket sera fermé dans 5 secondes.')
                            .setColor(CONFIG.colors.warning)],
                        ephemeral: true
                    });
                    
                    setTimeout(async () => {
                        await interaction.channel.delete();
                        await Logger.discord(
                            'Ticket Fermé',
                            `Le ticket a été fermé par **${interaction.user.tag}**.`,
                            CONFIG.colors.warning,
                            [],
                            interaction.user.displayAvatarURL()
                        );
                    }, 5000);
                }
            }
        });

        // Gestion de l'arrêt gracieux
        process.on('SIGINT', () => {
            Logger.info('Arrêt du bot en cours...');
            this.client.destroy();
            process.exit(0);
        });

        process.on('SIGTERM', () => {
            Logger.info('Signal SIGTERM reçu. Arrêt du bot...');
            this.client.destroy();
            process.exit(0);
        });
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
            Logger.fatal(`Échec critique au démarrage : ${error.message}`);
            Logger.error(error.stack);
            process.exit(1);
        }
    }
}

// ==========================================
// 7. INITIALISATION
// ==========================================
const bot = new VQCBot();
bot.start().catch(err => {
    Logger.fatal(`Erreur fatale : ${err.message}`);
    Logger.error(err.stack);
    process.exit(1);
});
