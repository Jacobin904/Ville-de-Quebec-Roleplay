/**
 * VQC Discord Bot - Architecture Enterprise
 * Développé pour Ville de Québec Roleplay
 * Version: 5.0.0 (Premium)
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
    server: {
        id: process.env.GUILD_ID || '1490410149213507804',
        name: 'Ville de Quebec Roleplay',
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
        maxWarnings: 3
    }
};

// ==========================================
// 2. SYSTÈME DE JOURNALISATION PROFESSIONNEL
// ==========================================
class Logger {
    static format(level, message) {
        const timestamp = new Date().toISOString();
        return `[${timestamp}] [${level.toUpperCase()}] ${message}`;
    }

    static info(msg) { console.log(Logger.format('info', msg)); }
    static warn(msg) { console.warn(Logger.format('warn', msg)); }
    static error(msg) { console.error(Logger.format('error', msg)); }
    static success(msg) { console.log(Logger.format('success', msg)); }

    static async discord(title, description, color = CONFIG.colors.primary, fields = [], thumbnail = null) {
        const embed = new EmbedBuilder()
            .setTitle(title)
            .setDescription(description)
            .setColor(color)
            .setFooter({ text: CONFIG.server.name, iconURL: CONFIG.server.icon })
            .setTimestamp();
        if (fields?.length) embed.addFields(fields);
        if (thumbnail) embed.setThumbnail(thumbnail);

        try {
            const channel = bot.client.channels.cache.get(CONFIG.channels.logs);
            if (channel) await channel.send({ embeds: [embed] }).catch(() => {});
        } catch (err) {
            this.error(`Echec envoi log Discord: ${err.message}`);
        }
    }
}

// ==========================================
// 3. BASE DE DONNÉES JSON ATOMIQUE (SANS MODULE NATIF)
// ==========================================
class Database {
    constructor(filePath) {
        this.filePath = filePath;
        this.data = { users: {}, warnings: [], tickets: {}, commands: {}, tags: {} };
        this.saveTimeout = null;
    }

    async init() {
        try {
            const content = await fs.readFile(this.filePath, 'utf8');
            this.data = JSON.parse(content);
            Logger.success('Base de donnees chargee avec succes');
        } catch (err) {
            Logger.warn('Base de donnees introuvable, creation d\'une nouvelle instance');
            await this.save();
        }
    }

    // Sauvegarde différée (Debounce) pour éviter les écritures disque excessives
    scheduleSave() {
        if (this.saveTimeout) clearTimeout(this.saveTimeout);
        this.saveTimeout = setTimeout(() => this.save(), 2000);
    }

    async save() {
        try {
            await fs.writeFile(this.filePath, JSON.stringify(this.data, null, 2), 'utf8');
        } catch (err) {
            Logger.error(`Echec de sauvegarde de la base de donnees: ${err.message}`);
        }
    }

    // --- Méthodes Utilisateurs ---
    getUser(id) { return this.data.users[id] || null; }
    
    createUser(id, username) {
        this.data.users[id] = {
            discord_id: id, username, level: 1, xp: 0, total_xp: 0,
            coins: 100, bank: 0, warnings: 0, last_xp: 0, last_daily: 0
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

    // --- Méthodes Tickets ---
    createTicket(channelId, userId) {
        this.data.tickets[channelId] = { channel_id: channelId, user_id: userId, status: 'open', created_at: new Date().toISOString() };
        this.scheduleSave();
    }

    closeTicket(channelId) {
        if (this.data.tickets[channelId]) {
            this.data.tickets[channelId].status = 'closed';
            this.scheduleSave();
        }
    }

    // --- Méthodes Commandes & Tags ---
    getCommand(name) { return this.data.commands[name] || null; }
    setCommand(name, response, createdBy) {
        this.data.commands[name] = { name, response, created_by: createdBy };
        this.scheduleSave();
    }
    deleteCommand(name) {
        delete this.data.commands[name];
        this.scheduleSave();
    }

    getTag(name) { return this.data.tags[name] || null; }
    setTag(name, content, createdBy) {
        this.data.tags[name] = { name, content, created_by: createdBy, uses: 0 };
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

const db = new Database(path.join(__dirname, 'vqc_data.json'));

// ==========================================
// 4. CLASSE PRINCIPALE DU BOT
// ==========================================
class VQCBot {
    constructor() {
        this.client = new Client({
            intents: [
                GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages,
                GatewayIntentBits.MessageContent, GatewayIntentBits.GuildModeration, GatewayIntentBits.GuildVoiceStates,
                GatewayIntentBits.GuildMessageReactions, GatewayIntentBits.GuildPresences
            ]
        });
        this.commands = new Collection();
        this.cooldowns = new Collection();
        this.expressApp = express();
        
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

        this.expressApp.get('/', (req, res) => {
            res.status(200).json({
                status: 'online',
                name: CONFIG.server.name,
                uptime: process.uptime(),
                members: this.client.guilds.cache.get(CONFIG.server.id)?.memberCount || 0
            });
        });

        this.expressApp.get('/api/stats', (req, res) => {
            const guild = this.client.guilds.cache.get(CONFIG.server.id);
            if (!guild) return res.status(404).json({ error: 'Serveur non trouve' });
            const onlineCount = guild.members.cache.filter(m => !m.user.bot && m.presence?.status !== 'offline').size;
            res.json({ totalMembers: guild.memberCount, onlineMembers: onlineCount, botPing: this.client.ws.ping, uptime: process.uptime() });
        });

        const PORT = process.env.PORT || 3000;
        this.expressApp.listen(PORT, '0.0.0.0', () => {
            Logger.success(`Serveur API actif sur http://0.0.0.0:${PORT}`);
        });
    }

    setupEvents() {
        this.client.once('clientReady', async () => {
            Logger.success(`Connecte en tant que ${this.client.user.tag}`);
            this.client.user.setPresence({ activities: [{ name: 'Ville de Quebec Roleplay', type: ActivityType.Watching }], status: 'online' });
            
            await Logger.discord('Systeme demarre', `Le bot est operationnel.\n**Identite :** ${this.client.user.tag}`, CONFIG.colors.success, [], this.client.user.displayAvatarURL());
            
            // Enregistrement des commandes après la connexion
            try {
                const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
                await rest.put(Routes.applicationGuildCommands(this.client.user.id, CONFIG.server.id), { body: Array.from(this.commands.values()).map(cmd => cmd.toJSON()) });
                Logger.success('Commandes slash enregistrees avec succes');
            } catch (error) {
                Logger.error(`Echec enregistrement commandes: ${error.message}`);
            }
        });

        this.client.on('guildMemberAdd', async (member) => {
            if (member.guild.id !== CONFIG.server.id) return;
            if (!db.getUser(member.id)) db.createUser(member.id, member.user.tag);
            
            await Logger.discord('Nouveau membre', `**${member.user.tag}** a rejoint le serveur.`, CONFIG.colors.success, [
                { name: 'Identifiant', value: member.id, inline: true },
                { name: 'Compte cree', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, inline: true }
            ], member.user.displayAvatarURL());
        });

        this.client.on('messageCreate', async (message) => {
            if (message.author.bot || message.guild?.id !== CONFIG.server.id) return;

            if (!db.getUser(message.author.id)) db.createUser(message.author.id, message.author.tag);

            // Système de niveaux avancé
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
                    message.reply({ embeds: [new EmbedBuilder().setTitle('Niveau superieur').setDescription(`Felicitation ${message.author} ! Tu es passe au niveau **${newLevel}**.`).setColor(CONFIG.colors.success)] }).catch(() => {});
                }
                db.updateUserXP(message.author.id, newXP, newTotalXP, newLevel, now);
            }

            // Commandes préfixées
            if (message.content.startsWith('!')) {
                const args = message.content.slice(1).trim().split(/ +/);
                const cmdName = args.shift().toLowerCase();
                const cmd = db.getCommand(cmdName);
                if (cmd) await message.reply(cmd.response).catch(() => {});
            }

            // Système de tags
            if (message.content.toLowerCase().startsWith('!tag ')) {
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
                await this.handleCommand(interaction);
            } else if (interaction.isButton() || interaction.isModalSubmit()) {
                await this.handleComponent(interaction);
            }
        });

        // Arrêt gracieux
        process.on('SIGINT', () => {
            Logger.info('Arret du bot en cours...');
            this.client.destroy();
            process.exit(0);
        });
    }

    async handleCommand(interaction) {
        const command = this.commands.get(interaction.commandName);
        if (!command) return;

        try {
            // Gestion des cooldowns
            if (command.cooldown) {
                if (!this.cooldowns.has(command.data.name)) this.cooldowns.set(command.data.name, new Collection());
                const now = Date.now();
                const timestamps = this.cooldowns.get(command.data.name);
                const cooldownAmount = (command.cooldown || 3) * 1000;

                if (timestamps.has(interaction.user.id)) {
                    const expirationTime = timestamps.get(interaction.user.id) + cooldownAmount;
                    if (now < expirationTime) {
                        const timeLeft = (expirationTime - now) / 1000;
                        return interaction.reply({ embeds: [new EmbedBuilder().setTitle('Cooldown').setDescription(`Veuillez attendre ${timeLeft.toFixed(1)} secondes.`).setColor(CONFIG.colors.warning)], ephemeral: true });
                    }
                }
                timestamps.set(interaction.user.id, now);
                setTimeout(() => timestamps.delete(interaction.user.id), cooldownAmount);
            }

            await command.execute(interaction, this.client, db);
        } catch (error) {
            Logger.error(`Erreur commande ${interaction.commandName}: ${error.message}`);
            const reply = { embeds: [new EmbedBuilder().setTitle('Erreur').setDescription('Une erreur interne est survenue.').setColor(CONFIG.colors.danger)], ephemeral: true };
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp(reply);
            } else {
                await interaction.reply(reply);
            }
        }
    }

    async handleComponent(interaction) {
        try {
            if (interaction.isButton()) {
                if (interaction.customId === 'close_ticket') {
                    if (!interaction.channel.name.startsWith('ticket-')) {
                        return interaction.reply({ embeds: [new EmbedBuilder().setTitle('Erreur').setDescription('Cette commande ne fonctionne que dans un ticket.').setColor(CONFIG.colors.danger)], ephemeral: true });
                    }
                    db.closeTicket(interaction.channel.id);
                    await interaction.reply({ embeds: [new EmbedBuilder().setTitle('Fermeture').setDescription('Le ticket sera ferme dans 5 secondes...').setColor(CONFIG.colors.warning)], ephemeral: true });
                    setTimeout(async () => {
                        await interaction.channel.delete();
                        await Logger.discord('Ticket ferme', `Le ticket a ete ferme par **${interaction.user.tag}**.`, CONFIG.colors.warning, [], interaction.user.displayAvatarURL());
                    }, 5000);
                }
            } else if (interaction.isModalSubmit()) {
                if (interaction.customId === 'create_ticket_modal') {
                    const reason = interaction.fields.getTextInputValue('ticket_reason');
                    const guild = interaction.guild;
                    const ticketChannel = await guild.channels.create({
                        name: `ticket-${interaction.user.username.toLowerCase()}`,
                        type: ChannelType.GuildText,
                        permissionOverwrites: [
                            { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                            { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }
                        ]
                    });
                    
                    db.createTicket(ticketChannel.id, interaction.user.id);
                    
                    await ticketChannel.send({ 
                        content: `${interaction.user}`, 
                        embeds: [new EmbedBuilder().setTitle('Nouveau ticket').setDescription(`**Raison :** ${reason}\n\nUn membre du staff va prendre en charge ta demande.`).setColor(CONFIG.colors.primary).setTimestamp()] 
                    });
                    
                    await interaction.reply({ embeds: [new EmbedBuilder().setTitle('Succes').setDescription(`Ticket cree : ${ticketChannel}`).setColor(CONFIG.colors.success)], ephemeral: true });
                }
            }
        } catch (error) {
            Logger.error(`Erreur composant: ${error.message}`);
        }
    }

    async start() {
        try {
            await db.init();
            this.registerCommands();
            await this.client.login(process.env.DISCORD_TOKEN);
            Logger.success('Connexion Discord etablie');
        } catch (error) {
            Logger.error(`Echec critique au demarrage: ${error.message}`);
            process.exit(1);
        }
    }

    registerCommands() {
        const cmds = [
            new SlashCommandBuilder().setName('ping').setDescription('Verifie la latence du bot'),
            new SlashCommandBuilder().setName('help').setDescription('Affiche la liste des commandes'),
            new SlashCommandBuilder().setName('rank').setDescription('Voir ton rang et ton experience').addUserOption(o => o.setName('utilisateur').setDescription('L\'utilisateur')),
            new SlashCommandBuilder().setName('leaderboard').setDescription('Voir le classement de l\'experience'),
            new SlashCommandBuilder().setName('balance').setDescription('Voir ton solde').addUserOption(o => o.setName('utilisateur').setDescription('L\'utilisateur')),
            new SlashCommandBuilder().setName('daily').setDescription('Reclamer ta recompense quotidienne'),
            new SlashCommandBuilder().setName('give').setDescription('Donner des pieces a quelqu\'un').addUserOption(o => o.setName('utilisateur').setDescription('L\'utilisateur').setRequired(true)).addIntegerOption(o => o.setName('montant').setDescription('Montant').setRequired(true)),
            new SlashCommandBuilder().setName('warn').setDescription('Avertir un membre').setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers).addUserOption(o => o.setName('membre').setDescription('Le membre').setRequired(true)).addStringOption(o => o.setName('raison').setDescription('Raison').setRequired(true)),
            new SlashCommandBuilder().setName('clear').setDescription('Supprime des messages').setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages).addIntegerOption(o => o.setName('nombre').setDescription('Nombre (max 100)').setRequired(true).setMinValue(1).setMaxValue(100)),
            new SlashCommandBuilder().setName('ticket').setDescription('Ouvre un ticket de support'),
            new SlashCommandBuilder().setName('tagadd').setDescription('Creer une etiquette').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild).addStringOption(o => o.setName('nom').setDescription('Nom').setRequired(true)).addStringOption(o => o.setName('contenu').setDescription('Contenu').setRequired(true)),
            new SlashCommandBuilder().setName('tagdelete').setDescription('Supprimer une etiquette').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild).addStringOption(o => o.setName('nom').setDescription('Nom').setRequired(true)),
            new SlashCommandBuilder().setName('ccadd').setDescription('Creer une commande personnalisee').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild).addStringOption(o => o.setName('nom').setDescription('Nom (sans !)').setRequired(true)).addStringOption(o => o.setName('reponse').setDescription('Reponse').setRequired(true)),
            new SlashCommandBuilder().setName('ccdelete').setDescription('Supprimer une commande personnalisee').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild).addStringOption(o => o.setName('nom').setDescription('Nom').setRequired(true)),
            new SlashCommandBuilder().setName('userinfo').setDescription('Affiche les informations d\'un utilisateur').addUserOption(o => o.setName('membre').setDescription('Le membre')),
            new SlashCommandBuilder().setName('serverinfo').setDescription('Affiche les informations du serveur'),
            new SlashCommandBuilder().setName('scan').setDescription('Analyse complete du serveur en 5 fichiers JSON')
        ];

        cmds.forEach(cmd => this.commands.set(cmd.name, {
            data: cmd,
            cooldown: 3,
            execute: async (interaction, client, database) => {
                await this.executeCommandLogic(interaction.commandName, interaction, client, database);
            }
        }));
    }

    async executeCommandLogic(commandName, interaction, client, database) {
        const { options, user, guild, member } = interaction;

        switch (commandName) {
            case 'ping':
                await interaction.reply({ embeds: [new EmbedBuilder().setTitle('Latence').setDescription(`Latence API : **${client.ws.ping}ms**`).setColor(CONFIG.colors.primary)] });
                break;

            case 'help':
                await interaction.reply({
                    embeds: [new EmbedBuilder().setTitle('Centre de commandes').setDescription('Liste complete des fonctionnalites disponibles.').setColor(CONFIG.colors.primary)
                        .addFields(
                            { name: 'Informations', value: '`/ping`, `/help`, `/userinfo`, `/serverinfo`', inline: false },
                            { name: 'Progression', value: '`/rank`, `/leaderboard`, `/balance`, `/daily`, `/give`', inline: false },
                            { name: 'Moderation', value: '`/warn`, `/clear`', inline: false },
                            { name: 'Support & Utilitaires', value: '`/ticket`, `/tagadd`, `/tagdelete`, `/ccadd`, `/ccdelete`', inline: false }
                        ).setFooter({ text: CONFIG.server.name, iconURL: CONFIG.server.icon }).setTimestamp()
                    ], ephemeral: true
                });
                break;

            case 'rank': {
                const target = options.getUser('utilisateur') || user;
                const userData = database.getUser(target.id);
                if (!userData) return interaction.reply({ embeds: [new EmbedBuilder().setTitle('Erreur').setDescription('Utilisateur non trouve.').setColor(CONFIG.colors.danger)], ephemeral: true });
                
                const xpNeeded = userData.level * 100 + (userData.level - 1) * 50;
                await interaction.reply({
                    embeds: [new EmbedBuilder().setTitle(`Rang de ${target.username}`).setDescription(`**Niveau :** ${userData.level}\n**XP :** ${userData.xp}/${xpNeeded}\n**XP total :** ${userData.total_xp}`).setColor(CONFIG.colors.primary).setThumbnail(target.displayAvatarURL()).setFooter({ text: CONFIG.server.name, iconURL: CONFIG.server.icon }).setTimestamp()]
                });
                break;
            }

            case 'balance': {
                const target = options.getUser('utilisateur') || user;
                const userData = database.getUser(target.id);
                if (!userData) return interaction.reply({ embeds: [new EmbedBuilder().setTitle('Erreur').setDescription('Utilisateur non trouve.').setColor(CONFIG.colors.danger)], ephemeral: true });
                
                await interaction.reply({
                    embeds: [new EmbedBuilder().setTitle(`Solde de ${target.username}`).setDescription(`**Pieces :** ${userData.coins}\n**Banque :** ${userData.bank}\n**Total :** ${userData.coins + userData.bank}`).setColor(CONFIG.colors.primary).setThumbnail(target.displayAvatarURL()).setFooter({ text: CONFIG.server.name, iconURL: CONFIG.server.icon }).setTimestamp()]
                });
                break;
            }

            case 'daily': {
                const userData = database.getUser(user.id);
                const now = Date.now();
                if (userData.last_daily && now - userData.last_daily < CONFIG.limits.dailyCooldown) {
                    const remaining = Math.ceil((CONFIG.limits.dailyCooldown - (now - userData.last_daily)) / 3600000);
                    return interaction.reply({ embeds: [new EmbedBuilder().setTitle('Erreur').setDescription(`Reviens dans **${remaining} heure(s)**.`).setColor(CONFIG.colors.danger)], ephemeral: true });
                }
                const reward = Math.floor(Math.random() * 100) + 50;
                database.updateCoins(user.id, userData.coins + reward);
                database.data.users[user.id].last_daily = now;
                database.scheduleSave();
                
                await interaction.reply({ embeds: [new EmbedBuilder().setTitle('Recompense quotidienne').setDescription(`Tu as recu **${reward} pieces** !`).setColor(CONFIG.colors.success).setFooter({ text: CONFIG.server.name, iconURL: CONFIG.server.icon }).setTimestamp()] });
                break;
            }

            case 'give': {
                const target = options.getUser('utilisateur');
                const amount = options.getInteger('montant');
                if (target.id === user.id) return interaction.reply({ embeds: [new EmbedBuilder().setTitle('Erreur').setDescription('Action interdite sur soi-meme.').setColor(CONFIG.colors.danger)], ephemeral: true });
                
                const sender = database.getUser(user.id);
                if (!sender || sender.coins < amount) return interaction.reply({ embeds: [new EmbedBuilder().setTitle('Erreur').setDescription('Fonds insuffisants.').setColor(CONFIG.colors.danger)], ephemeral: true });
                
                if (!database.getUser(target.id)) database.createUser(target.id, target.tag);
                const receiver = database.getUser(target.id);
                
                database.updateCoins(user.id, sender.coins - amount);
                database.updateCoins(target.id, receiver.coins + amount);
                
                await interaction.reply({ embeds: [new EmbedBuilder().setTitle('Transfert effectue').setDescription(`**${amount} pieces** envoyees a ${target}.`).setColor(CONFIG.colors.success).setFooter({ text: CONFIG.server.name, iconURL: CONFIG.server.icon }).setTimestamp()] });
                break;
            }

            case 'warn': {
                const target = options.getUser('membre');
                const reason = options.getString('raison');
                if (!database.getUser(target.id)) database.createUser(target.id, target.tag);
                
                database.data.warnings.push({ user_id: target.id, moderator_id: user.id, reason, created_at: new Date().toISOString() });
                database.addWarning(target.id);
                
                await Logger.discord('Avertissement', `**${user.tag}** a averti **${target.tag}**\nRaison: ${reason}`, CONFIG.colors.warning, [], target.displayAvatarURL());
                
                try {
                    await target.send({ embeds: [new EmbedBuilder().setTitle('Avertissement').setDescription(`Tu as recu un avertissement sur **${guild.name}**.\nRaison : ${reason}`).setColor(CONFIG.colors.warning).setTimestamp()] });
                } catch (e) {}
                
                const updated = database.getUser(target.id);
                await interaction.reply({ embeds: [new EmbedBuilder().setTitle('Succes').setDescription(`${target} a ete averti. (Total: ${updated.warnings})`).setColor(CONFIG.colors.success)], ephemeral: true });
                break;
            }

            case 'clear': {
                const amount = options.getInteger('nombre');
                await interaction.channel.bulkDelete(amount, true);
                await interaction.reply({ embeds: [new EmbedBuilder().setTitle('Succes').setDescription(`${amount} messages supprimes.`).setColor(CONFIG.colors.success)], ephemeral: true });
                await Logger.discord('Messages supprimes', `**${user.tag}** a supprime **${amount}** messages.`, CONFIG.colors.warning, [], user.displayAvatarURL());
                break;
            }

            case 'ticket': {
                const modal = new ModalBuilder().setCustomId('create_ticket_modal').setTitle('Creer un ticket');
                const reasonInput = new TextInputBuilder().setCustomId('ticket_reason').setLabel('Raison de la demande').setStyle(TextInputStyle.Paragraph).setRequired(true);
                modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
                await interaction.showModal(modal);
                break;
            }

            case 'tagadd': {
                const name = options.getString('nom');
                const content = options.getString('contenu');
                try {
                    database.setTag(name, content, user.id);
                    await interaction.reply({ embeds: [new EmbedBuilder().setTitle('Succes').setDescription(`L'etiquette **${name}** a ete creee.`).setColor(CONFIG.colors.success)], ephemeral: true });
                } catch (e) {
                    await interaction.reply({ embeds: [new EmbedBuilder().setTitle('Erreur').setDescription('Cette etiquette existe deja.').setColor(CONFIG.colors.danger)], ephemeral: true });
                }
                break;
            }

            case 'tagdelete': {
                database.deleteTag(options.getString('nom'));
                await interaction.reply({ embeds: [new EmbedBuilder().setTitle('Succes').setDescription('Etiquette supprimee.').setColor(CONFIG.colors.success)], ephemeral: true });
                break;
            }

            case 'ccadd': {
                const name = options.getString('nom');
                const response = options.getString('reponse');
                try {
                    database.setCommand(name, response, user.id);
                    await interaction.reply({ embeds: [new EmbedBuilder().setTitle('Succes').setDescription(`La commande **!${name}** a ete creee.`).setColor(CONFIG.colors.success)], ephemeral: true });
                } catch (e) {
                    await interaction.reply({ embeds: [new EmbedBuilder().setTitle('Erreur').setDescription('Cette commande existe deja.').setColor(CONFIG.colors.danger)], ephemeral: true });
                }
                break;
            }

            case 'ccdelete': {
                database.deleteCommand(options.getString('nom'));
                await interaction.reply({ embeds: [new EmbedBuilder().setTitle('Succes').setDescription('Commande supprimee.').setColor(CONFIG.colors.success)], ephemeral: true });
                break;
            }

            case 'userinfo': {
                const target = options.getMember('membre') || member;
                const roles = target.roles.cache.filter(r => r.id !== guild.id).map(r => r.name).join(', ') || 'Aucun';
                await interaction.reply({
                    embeds: [new EmbedBuilder().setTitle(`Informations de ${target.user.username}`).setColor(CONFIG.colors.primary).setThumbnail(target.user.displayAvatarURL())
                        .addFields({ name: 'Pseudo', value: target.displayName, inline: true }, { name: 'Identifiant', value: target.id, inline: true }, { name: 'Compte cree', value: `<t:${Math.floor(target.user.createdTimestamp / 1000)}:D>`, inline: true }, { name: 'Roles', value: roles.substring(0, 1000), inline: false })
                        .setFooter({ text: CONFIG.server.name, iconURL: CONFIG.server.icon }).setTimestamp()]
                });
                break;
            }

            case 'serverinfo': {
                await interaction.reply({
                    embeds: [new EmbedBuilder().setTitle(`Informations du serveur`).setDescription(`Details de **${guild.name}**.`).setColor(CONFIG.colors.primary).setThumbnail(guild.iconURL())
                        .addFields({ name: 'Proprietaire', value: `<@${guild.ownerId}>`, inline: true }, { name: 'Membres', value: `${guild.memberCount}`, inline: true }, { name: 'Salons', value: `${guild.channels.cache.size}`, inline: true }, { name: 'Roles', value: `${guild.roles.cache.size}`, inline: true })
                        .setFooter({ text: CONFIG.server.name, iconURL: CONFIG.server.icon }).setTimestamp()]
                });
                break;
            }

            case 'scan': {
                await interaction.deferReply({ ephemeral: true });
                const items = [];
                items.push({ _type: 'server_info', id: guild.id, name: guild.name, ownerId: guild.ownerId, memberCount: guild.memberCount });
                guild.channels.cache.forEach(ch => items.push({ _type: 'channel', id: ch.id, name: ch.name, type: ChannelType[ch.type] }));
                guild.roles.cache.forEach(role => items.push({ _type: 'role', id: role.id, name: role.name, color: role.hexColor }));
                guild.members.cache.forEach(m => items.push({ _type: 'member', id: m.id, username: m.user.username, displayName: m.displayName }));
                
                items.sort((a, b) => JSON.stringify(b).length - JSON.stringify(a).length);
                const buckets = Array.from({ length: 5 }, () => ({ items: [], size: 0 }));
                for (const item of items) {
                    const itemSize = JSON.stringify(item).length;
                    const smallestBucket = buckets.reduce((prev, curr) => prev.size < curr.size ? prev : curr);
                    smallestBucket.items.push(item);
                    smallestBucket.size += itemSize;
                }

                const files = [];
                const timestamp = Date.now();
                const safeName = guild.name.replace(/\s+/g, '_');
                for (let i = 0; i < 5; i++) {
                    const metaData = { _meta: { file: i + 1, total_files: 5, server: guild.name, timestamp: new Date().toISOString(), item_count: buckets[i].items.length }, data: buckets[i].items };
                    files.push({ attachment: Buffer.from(JSON.stringify(metaData, null, 2), 'utf-8'), name: `scan_partie_${i + 1}_sur_5_${safeName}_${timestamp}.json` });
                }
                await interaction.followUp({ embeds: [new EmbedBuilder().setTitle('Analyse terminee').setDescription('L\'analyse a genere **5 fichiers JSON** contenant toutes les informations du serveur.').setColor(CONFIG.colors.success).setTimestamp()], files: files, ephemeral: true });
                break;
            }
        }
    }
}

// ==========================================
// 5. INITIALISATION
// ==========================================
const bot = new VQCBot();
bot.start().catch(err => {
    Logger.error(`Erreur fatale: ${err.message}`);
    process.exit(1);
});
