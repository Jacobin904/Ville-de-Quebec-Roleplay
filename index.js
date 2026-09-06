require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const axios = require('axios');
const Database = require('better-sqlite3');
const { 
    Client, GatewayIntentBits, EmbedBuilder, SlashCommandBuilder, 
    REST, Routes, ChannelType, PermissionFlagsBits, 
    ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, 
    TextInputBuilder, TextInputStyle, PermissionsBitField,
    Collection, ActivityType
} = require('discord.js');

// ==========================================
// CONFIGURATION AVANCÉE
// ==========================================
const CONFIG = {
    server: {
        id: '1490410149213507804',
        name: 'Ville de Québec Roleplay',
        icon: 'https://cdn.discordapp.com/icons/1490410149213507804/0b1aa46a2fdb33b133a0feb1234739f6.webp?size=1024'
    },
    channels: {
        logs: '1538659168012075029',
        modlogs: '1538659168012075029',
        welcome: null,
        suggestions: null
    },
    roles: {
        staff: ['1521217940035473429', '1533823925752959189', '1533824053935341598', '1490530623201345556', '1490530523083182250'],
        muted: null
    },
    colors: {
        primary: 0x003DA5,
        secondary: 0x3b82f6,
        tertiary: 0x60a5fa,
        success: 0x10b981,
        warning: 0xf59e0b,
        danger: 0xef4444,
        info: 0x06b6d4
    },
    limits: {
        maxWarnings: 3,
        xpCooldown: 60000,
        dailyCooldown: 86400000
    }
};

// ==========================================
// BASE DE DONNÉES AVANCÉE
// ==========================================
const dbPath = path.join(__dirname, 'vqc_database.sqlite');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        discord_id TEXT UNIQUE NOT NULL,
        username TEXT NOT NULL,
        level INTEGER DEFAULT 1,
        xp INTEGER DEFAULT 0,
        total_xp INTEGER DEFAULT 0,
        coins INTEGER DEFAULT 100,
        bank INTEGER DEFAULT 0,
        warnings INTEGER DEFAULT 0,
        total_warnings INTEGER DEFAULT 0,
        is_muted INTEGER DEFAULT 0,
        mute_expires INTEGER DEFAULT 0,
        last_xp INTEGER DEFAULT 0,
        last_daily INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS warnings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        moderator_id TEXT NOT NULL,
        reason TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(discord_id)
    );

    CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        type TEXT NOT NULL,
        amount INTEGER NOT NULL,
        description TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(discord_id)
    );

    CREATE TABLE IF NOT EXISTS tickets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        channel_id TEXT UNIQUE NOT NULL,
        user_id TEXT NOT NULL,
        status TEXT DEFAULT 'open',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        closed_at TEXT,
        closed_by TEXT
    );

    CREATE TABLE IF NOT EXISTS custom_commands (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        response TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        content TEXT NOT NULL,
        created_by TEXT NOT NULL,
        uses INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS reminders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        message TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS giveaways (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id TEXT UNIQUE NOT NULL,
        channel_id TEXT NOT NULL,
        host_id TEXT NOT NULL,
        prize TEXT NOT NULL,
        winners INTEGER DEFAULT 1,
        ends_at INTEGER NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS departments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        code TEXT NOT NULL,
        role_id TEXT,
        description TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_users_discord_id ON users(discord_id);
    CREATE INDEX IF NOT EXISTS idx_warnings_user_id ON warnings(user_id);
    CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id);
    CREATE INDEX IF NOT EXISTS idx_tickets_channel_id ON tickets(channel_id);
    CREATE INDEX IF NOT EXISTS idx_reminders_expires_at ON reminders(expires_at);
    CREATE INDEX IF NOT EXISTS idx_giveaways_ends_at ON giveaways(ends_at);
`);

// Requêtes préparées
const queries = {
    user: {
        get: db.prepare('SELECT * FROM users WHERE discord_id = ?'),
        create: db.prepare('INSERT INTO users (discord_id, username) VALUES (?, ?)'),
        updateXP: db.prepare('UPDATE users SET xp = ?, total_xp = ?, level = ?, last_xp = ?, updated_at = CURRENT_TIMESTAMP WHERE discord_id = ?'),
        updateCoins: db.prepare('UPDATE users SET coins = ?, updated_at = CURRENT_TIMESTAMP WHERE discord_id = ?'),
        updateBank: db.prepare('UPDATE users SET bank = ?, updated_at = CURRENT_TIMESTAMP WHERE discord_id = ?'),
        addWarning: db.prepare('UPDATE users SET warnings = warnings + 1, total_warnings = total_warnings + 1, updated_at = CURRENT_TIMESTAMP WHERE discord_id = ?'),
        setMuted: db.prepare('UPDATE users SET is_muted = ?, mute_expires = ?, updated_at = CURRENT_TIMESTAMP WHERE discord_id = ?'),
        setDaily: db.prepare('UPDATE users SET last_daily = ?, updated_at = CURRENT_TIMESTAMP WHERE discord_id = ?'),
        getTop: db.prepare('SELECT * FROM users ORDER BY total_xp DESC LIMIT ?'),
        getAll: db.prepare('SELECT * FROM users')
    },
    warning: {
        create: db.prepare('INSERT INTO warnings (user_id, moderator_id, reason) VALUES (?, ?, ?)'),
        getByUser: db.prepare('SELECT * FROM warnings WHERE user_id = ? ORDER BY created_at DESC'),
        getAll: db.prepare('SELECT * FROM warnings ORDER BY created_at DESC LIMIT ?')
    },
    transaction: {
        create: db.prepare('INSERT INTO transactions (user_id, type, amount, description) VALUES (?, ?, ?, ?)'),
        getByUser: db.prepare('SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?')
    },
    ticket: {
        create: db.prepare('INSERT INTO tickets (channel_id, user_id) VALUES (?, ?)'),
        getByChannel: db.prepare('SELECT * FROM tickets WHERE channel_id = ?'),
        close: db.prepare('UPDATE tickets SET status = ?, closed_at = CURRENT_TIMESTAMP, closed_by = ? WHERE channel_id = ?'),
        getOpen: db.prepare('SELECT * FROM tickets WHERE status = ?')
    },
    command: {
        get: db.prepare('SELECT * FROM custom_commands WHERE name = ?'),
        create: db.prepare('INSERT INTO custom_commands (name, response, created_by) VALUES (?, ?, ?)'),
        delete: db.prepare('DELETE FROM custom_commands WHERE name = ?'),
        getAll: db.prepare('SELECT * FROM custom_commands')
    },
    tag: {
        get: db.prepare('SELECT * FROM tags WHERE name = ?'),
        create: db.prepare('INSERT INTO tags (name, content, created_by) VALUES (?, ?, ?)'),
        delete: db.prepare('DELETE FROM tags WHERE name = ?'),
        incrementUses: db.prepare('UPDATE tags SET uses = uses + 1 WHERE name = ?'),
        getAll: db.prepare('SELECT * FROM tags ORDER BY uses DESC')
    },
    reminder: {
        create: db.prepare('INSERT INTO reminders (user_id, message, expires_at) VALUES (?, ?, ?)'),
        getExpired: db.prepare('SELECT * FROM reminders WHERE expires_at <= ?'),
        delete: db.prepare('DELETE FROM id = ?')
    },
    giveaway: {
        create: db.prepare('INSERT INTO giveaways (message_id, channel_id, host_id, prize, winners, ends_at) VALUES (?, ?, ?, ?, ?, ?)'),
        getEnded: db.prepare('SELECT * FROM giveaways WHERE ends_at <= ?'),
        delete: db.prepare('DELETE FROM message_id = ?')
    }
};

// ==========================================
// SYSTÈME DE LOGS AVANCÉ
// ==========================================
class Logger {
    static async log(title, description, color = CONFIG.colors.primary, fields = [], thumbnail = null) {
        const embed = new EmbedBuilder()
            .setTitle(title)
            .setDescription(description)
            .setColor(color)
            .setFooter({ text: CONFIG.server.name, iconURL: CONFIG.server.icon })
            .setTimestamp();

        if (fields.length > 0) embed.addFields(fields);
        if (thumbnail) embed.setThumbnail(thumbnail);

        try {
            const channel = client.channels.cache.get(CONFIG.channels.logs);
            if (channel) {
                await channel.send({ embeds: [embed] });
                return;
            }
        } catch (err) {
            console.error('[LOGGER] Erreur canal:', err.message);
        }

        console.log(`[LOG] ${title}: ${description}`);
    }

    static async modLog(action, target, moderator, reason, color = CONFIG.colors.warning) {
        const fields = [
            { name: 'Cible', value: `<@${target.id}> (${target.id})`, inline: true },
            { name: 'Modérateur', value: `<@${moderator.id}>`, inline: true },
            { name: 'Raison', value: reason || 'Aucune raison spécifiée', inline: false }
        ];

        await this.log(`[MODÉRATION] ${action}`, '', color, fields, target.displayAvatarURL());
    }

    static info(message) { console.log(`[INFO] ${message}`); }
    static warn(message) { console.warn(`[WARN] ${message}`); }
    static error(message) { console.error(`[ERROR] ${message}`); }
    static success(message) { console.log(`[SUCCESS] ${message}`); }
}

// ==========================================
// CLIENT DISCORD
// ==========================================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildModeration,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildEmojisAndStickers,
        GatewayIntentBits.GuildPresences
    ]
});

client.commands = new Collection();
client.cooldowns = new Collection();
client.tempVoiceChannels = new Map();

// ==========================================
// SERVEUR EXPRESS ET API
// ==========================================
const app = express();
const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';

app.use(express.json());
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    next();
});

app.get('/', (req, res) => {
    res.status(200).json({
        status: 'online',
        name: CONFIG.server.name,
        uptime: process.uptime(),
        members: client.guilds.cache.get(CONFIG.server.id)?.memberCount || 0
    });
});

const verifyAPI = (req, res, next) => {
    const key = req.headers['x-api-key'];
    if (key === process.env.API_SECRET) return next();
    return res.status(401).json({ error: 'Non autorisé' });
};

app.get('/api/stats', (req, res) => {
    const guild = client.guilds.cache.get(CONFIG.server.id);
    if (!guild) return res.status(404).json({ error: 'Serveur non trouvé' });

    const onlineCount = guild.members.cache.filter(m => !m.user.bot && m.presence?.status !== 'offline').size;
    
    res.json({
        totalMembers: guild.memberCount,
        onlineMembers: onlineCount,
        botPing: client.ws.ping,
        uptime: process.uptime()
    });
});

app.get('/api/staff', verifyAPI, (req, res) => {
    const guild = client.guilds.cache.get(CONFIG.server.id);
    if (!guild) return res.status(404).json({ error: 'Serveur non trouvé' });

    const onlineStaff = guild.members.cache
        .filter(m => !m.user.bot && m.presence?.status !== 'offline' && m.roles.cache.some(r => CONFIG.roles.staff.includes(r.id)))
        .map(m => ({
            id: m.id,
            username: m.user.username,
            displayName: m.displayName,
            roles: m.roles.cache.filter(r => CONFIG.roles.staff.includes(r.id)).map(r => r.name)
        }));

    res.json({ staffOnline: onlineStaff });
});

app.get('/api/leaderboard', verifyAPI, (req, res) => {
    const limit = parseInt(req.query.limit) || 10;
    const topUsers = queries.user.getTop.all(limit);
    res.json({ leaderboard: topUsers });
});

// ==========================================
// SYSTÈME DE NIVEAUX ET ÉCONOMIE
// ==========================================
function calculateXP(level) {
    return level * 100 + (level - 1) * 50;
}

function addXP(userId, amount) {
    const user = queries.user.get.get(userId);
    if (!user) return null;

    const now = Date.now();
    if (now - user.last_xp < CONFIG.limits.xpCooldown) return null;

    let newXP = user.xp + amount;
    let newTotalXP = user.total_xp + amount;
    let newLevel = user.level;

    while (newXP >= calculateXP(newLevel)) {
        newXP -= calculateXP(newLevel);
        newLevel++;
    }

    queries.user.updateXP.run(newXP, newTotalXP, newLevel, now, userId);
    return { level: newLevel, leveledUp: newLevel > user.level };
}

function addCoins(userId, amount, type, description) {
    const user = queries.user.get.get(userId);
    if (!user) return false;

    const newCoins = user.coins + amount;
    queries.user.updateCoins.run(newCoins, userId);
    queries.transaction.create.run(userId, type, amount, description);
    return true;
}

// ==========================================
// GESTION DES RAPPELS
// ==========================================
setInterval(() => {
    const now = Math.floor(Date.now() / 1000);
    const expired = queries.reminder.getExpired.all(now);

    expired.forEach(reminder => {
        const user = client.users.cache.get(reminder.user_id);
        if (user) {
            user.send({
                embeds: [new EmbedBuilder()
                    .setTitle('Rappel')
                    .setDescription(reminder.message)
                    .setColor(CONFIG.colors.info)
                    .setTimestamp()
                ]
            }).catch(() => {});
        }
        queries.reminder.delete.run(reminder.id);
    });
}, 60000);

// ==========================================
// GESTION DES GIVEAWAYS
// ==========================================
setInterval(async () => {
    const now = Math.floor(Date.now() / 1000);
    const ended = queries.giveaway.getEnded.all(now);

    for (const giveaway of ended) {
        try {
            const channel = client.channels.cache.get(giveaway.channel_id);
            if (!channel) continue;

            const message = await channel.messages.fetch(giveaway.message_id).catch(() => null);
            if (!message) continue;

            const reaction = message.reactions.cache.find(r => r.emoji.name === '🎉');
            if (!reaction) continue;

            const users = await reaction.users.fetch();
            const participants = users.filter(u => !u.bot && u.id !== client.user.id);

            if (participants.size === 0) {
                await channel.send({
                    embeds: [new EmbedBuilder()
                        .setTitle('Giveaway terminé')
                        .setDescription('Aucun participant valide.')
                        .setColor(CONFIG.colors.danger)
                    ]
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
                        .setTitle('Giveaway terminé')
                        .setDescription(`Prix : **${giveaway.prize}**\nGagnant(s) : ${winners.map(w => `<@${w.id}>`).join(', ')}`)
                        .setColor(CONFIG.colors.success)
                    ]
                });
            }

            queries.giveaway.delete.run(giveaway.message_id);
        } catch (err) {
            Logger.error(`Erreur giveaway ${giveaway.id}: ${err.message}`);
        }
    }
}, 60000);

// ==========================================
// ÉVÉNEMENTS DISCORD
// ==========================================
client.once('clientReady', async () => {
    Logger.success(`Connecté en tant que ${client.user.tag}`);
    Logger.info(`Serveurs : ${client.guilds.cache.size}`);
    Logger.info(`Membres : ${client.guilds.cache.reduce((acc, g) => acc + g.memberCount, 0)}`);

    client.user.setPresence({
        activities: [{ name: 'Ville de Québec Roleplay', type: ActivityType.Watching }],
        status: 'online'
    });

    await Logger.log(
        'Système démarré',
        `Le bot est maintenant opérationnel.\n\n**Identité :** ${client.user.tag}\n**Uptime :** 0 secondes`,
        CONFIG.colors.success,
        [],
        client.user.displayAvatarURL()
    );
});

client.on('guildMemberAdd', async (member) => {
    if (member.guild.id !== CONFIG.server.id) return;

    queries.user.create.run(member.id, member.user.tag);

    await Logger.log(
        'Nouveau membre',
        `**${member.user.tag}** a rejoint le serveur.`,
        CONFIG.colors.success,
        [
            { name: 'Identifiant', value: member.id, inline: true },
            { name: 'Compte créé', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, inline: true }
        ],
        member.user.displayAvatarURL()
    );
});

client.on('guildMemberRemove', async (member) => {
    if (member.guild.id !== CONFIG.server.id) return;

    await Logger.log(
        'Membre parti',
        `**${member.user.tag}** a quitté le serveur.`,
        CONFIG.colors.danger,
        [
            { name: 'Identifiant', value: member.id, inline: true },
            { name: 'A rejoint le', value: member.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>` : 'Inconnu', inline: true }
        ],
        member.user.displayAvatarURL()
    );
});

client.on('messageCreate', async (message) => {
    if (message.author.bot || message.guild.id !== CONFIG.server.id) return;

    const user = queries.user.get.get(message.author.id);
    if (!user) {
        queries.user.create.run(message.author.id, message.author.tag);
    }

    const xpResult = addXP(message.author.id, Math.floor(Math.random() * 15) + 10);
    if (xpResult && xpResult.leveledUp) {
        await message.reply({
            embeds: [new EmbedBuilder()
                .setTitle('Niveau supérieur')
                .setDescription(`Félicitations ${message.author} ! Tu es passé au niveau **${xpResult.level}**.`)
                .setColor(CONFIG.colors.success)
            ]
        }).catch(() => {});
    }

    if (message.content.startsWith('!')) {
        const args = message.content.slice(1).trim().split(/ +/);
        const commandName = args.shift().toLowerCase();

        const command = queries.command.get.get(commandName);
        if (command) {
            await message.reply(command.response);
        }
    }

    if (message.content.startsWith('!tag ')) {
        const tagName = message.content.slice(5).trim().toLowerCase();
        const tag = queries.tag.get.get(tagName);
        
        if (tag) {
            queries.tag.incrementUses.run(tagName);
            await message.reply(tag.content);
        }
    }
});

// ==========================================
// COMMANDES SLASH
// ==========================================
const commands = [
    new SlashCommandBuilder().setName('ping').setDescription('Vérifie la latence du bot'),
    new SlashCommandBuilder().setName('help').setDescription('Affiche la liste des commandes'),
    new SlashCommandBuilder().setName('invite').setDescription('Obtenir le lien d\'invitation du bot'),
    
    new SlashCommandBuilder().setName('rank').setDescription('Voir ton rang et ton expérience')
        .addUserOption(o => o.setName('utilisateur').setDescription('L\'utilisateur')),
    new SlashCommandBuilder().setName('leaderboard').setDescription('Voir le classement de l\'expérience'),
    new SlashCommandBuilder().setName('balance').setDescription('Voir ton solde')
        .addUserOption(o => o.setName('utilisateur').setDescription('L\'utilisateur')),
    new SlashCommandBuilder().setName('daily').setDescription('Réclamer ta récompense quotidienne'),
    new SlashCommandBuilder().setName('give').setDescription('Donner des pièces à quelqu\'un')
        .addUserOption(o => o.setName('utilisateur').setDescription('L\'utilisateur').setRequired(true))
        .addIntegerOption(o => o.setName('montant').setDescription('Montant').setRequired(true)),
    
    new SlashCommandBuilder().setName('warn').setDescription('Avertir un membre')
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .addUserOption(o => o.setName('membre').setDescription('Le membre').setRequired(true))
        .addStringOption(o => o.setName('raison').setDescription('Raison').setRequired(true)),
    new SlashCommandBuilder().setName('warnings').setDescription('Voir les avertissements d\'un utilisateur')
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .addUserOption(o => o.setName('utilisateur').setDescription('L\'utilisateur').setRequired(true)),
    new SlashCommandBuilder().setName('clear').setDescription('Supprime des messages')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
        .addIntegerOption(o => o.setName('nombre').setDescription('Nombre (max 100)').setRequired(true).setMinValue(1).setMaxValue(100)),
    new SlashCommandBuilder().setName('mute').setDescription('Rendre un membre muet')
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .addUserOption(o => o.setName('membre').setDescription('Le membre').setRequired(true))
        .addIntegerOption(o => o.setName('durée').setDescription('Durée en minutes').setRequired(true)),
    new SlashCommandBuilder().setName('unmute').setDescription('Retirer le mute d\'un membre')
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .addUserOption(o => o.setName('membre').setDescription('Le membre').setRequired(true)),
    
    new SlashCommandBuilder().setName('ticket').setDescription('Ouvre un ticket de support'),
    new SlashCommandBuilder().setName('close').setDescription('Ferme le ticket actuel')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
    
    new SlashCommandBuilder().setName('tag').setDescription('Afficher une étiquette')
        .addStringOption(o => o.setName('nom').setDescription('Nom de l\'étiquette').setRequired(true)),
    new SlashCommandBuilder().setName('tagadd').setDescription('Créer une étiquette')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addStringOption(o => o.setName('nom').setDescription('Nom').setRequired(true))
        .addStringOption(o => o.setName('contenu').setDescription('Contenu').setRequired(true)),
    new SlashCommandBuilder().setName('tagdelete').setDescription('Supprimer une étiquette')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addStringOption(o => o.setName('nom').setDescription('Nom').setRequired(true)),
    
    new SlashCommandBuilder().setName('ccadd').setDescription('Créer une commande personnalisée')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addStringOption(o => o.setName('nom').setDescription('Nom (sans !)').setRequired(true))
        .addStringOption(o => o.setName('réponse').setDescription('Réponse').setRequired(true)),
    new SlashCommandBuilder().setName('ccdelete').setDescription('Supprimer une commande personnalisée')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addStringOption(o => o.setName('nom').setDescription('Nom').setRequired(true)),
    
    new SlashCommandBuilder().setName('remind').setDescription('Définir un rappel')
        .addIntegerOption(o => o.setName('minutes').setDescription('Dans combien de minutes').setRequired(true))
        .addStringOption(o => o.setName('message').setDescription('Le rappel').setRequired(true)),
    
    new SlashCommandBuilder().setName('giveaway').setDescription('Créer un tirage au sort')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addStringOption(o => o.setName('prix').setDescription('Le prix').setRequired(true))
        .addIntegerOption(o => o.setName('durée').setDescription('Durée en minutes').setRequired(true))
        .addIntegerOption(o => o.setName('gagnants').setDescription('Nombre de gagnants').setRequired(true)),
    
    new SlashCommandBuilder().setName('userinfo').setDescription('Affiche les informations d\'un utilisateur')
        .addUserOption(o => o.setName('membre').setDescription('Le membre')),
    new SlashCommandBuilder().setName('serverinfo').setDescription('Affiche les informations du serveur'),
    
    new SlashCommandBuilder().setName('scan').setDescription('Analyse complète du serveur en 5 fichiers JSON')
];

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName, options } = interaction;

    try {
        switch (commandName) {
            case 'ping': {
                await interaction.reply({
                    embeds: [new EmbedBuilder()
                        .setTitle('Latence')
                        .setDescription(`Latence API : **${client.ws.ping}ms**`)
                        .setColor(CONFIG.colors.primary)
                    ]
                });
                break;
            }

            case 'help': {
                const embed = new EmbedBuilder()
                    .setTitle('Liste des commandes')
                    .setDescription('Voici la liste complète des commandes disponibles.')
                    .setColor(CONFIG.colors.primary)
                    .addFields(
                        { name: 'Informations', value: '`/ping`, `/help`, `/invite`, `/userinfo`, `/serverinfo`', inline: false },
                        { name: 'Niveaux et économie', value: '`/rank`, `/leaderboard`, `/balance`, `/daily`, `/give`', inline: false },
                        { name: 'Modération', value: '`/warn`, `/warnings`, `/clear`, `/mute`, `/unmute`', inline: false },
                        { name: 'Support', value: '`/ticket`, `/close`', inline: false },
                        { name: 'Utilitaires', value: '`/tag`, `/tagadd`, `/tagdelete`, `/ccadd`, `/ccdelete`, `/remind`, `/giveaway`', inline: false }
                    )
                    .setFooter({ text: CONFIG.server.name, iconURL: CONFIG.server.icon })
                    .setTimestamp();

                await interaction.reply({ embeds: [embed], ephemeral: true });
                break;
            }

            case 'invite': {
                await interaction.reply({
                    embeds: [new EmbedBuilder()
                        .setTitle('Invitation')
                        .setDescription(`[Cliquez ici pour inviter le bot](https://discord.com/api/oauth2/authorize?client_id=${client.user.id}&permissions=8&scope=bot%20applications.commands)`)
                        .setColor(CONFIG.colors.primary)
                    ]
                });
                break;
            }

            case 'rank': {
                const target = options.getUser('utilisateur') || interaction.user;
                const user = queries.user.get.get(target.id);

                if (!user) {
                    await interaction.reply({
                        embeds: [new EmbedBuilder()
                            .setTitle('Erreur')
                            .setDescription('Utilisateur non trouvé dans la base de données.')
                            .setColor(CONFIG.colors.danger)
                        ],
                        ephemeral: true
                    });
                    return;
                }

                const xpNeeded = calculateXP(user.level);
                const progress = Math.round((user.xp / xpNeeded) * 100);

                await interaction.reply({
                    embeds: [new EmbedBuilder()
                        .setTitle(`Rang de ${target.username}`)
                        .setDescription(`**Niveau :** ${user.level}\n**XP :** ${user.xp}/${xpNeeded} (${progress}%)\n**XP total :** ${user.total_xp}`)
                        .setColor(CONFIG.colors.primary)
                        .setThumbnail(target.displayAvatarURL())
                        .setFooter({ text: CONFIG.server.name, iconURL: CONFIG.server.icon })
                        .setTimestamp()
                    ]
                });
                break;
            }

            case 'leaderboard': {
                const topUsers = queries.user.getTop.all(10);

                if (topUsers.length === 0) {
                    await interaction.reply({
                        embeds: [new EmbedBuilder()
                            .setTitle('Classement')
                            .setDescription('Aucune donnée disponible.')
                            .setColor(CONFIG.colors.info)
                        ]
                    });
                    return;
                }

                const description = topUsers.map((u, i) => {
                    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
                    return `${medal} <@${u.discord_id}> - Niveau ${u.level} (${u.total_xp} XP total)`;
                }).join('\n');

                await interaction.reply({
                    embeds: [new EmbedBuilder()
                        .setTitle('Classement XP')
                        .setDescription(description)
                        .setColor(CONFIG.colors.primary)
                        .setFooter({ text: CONFIG.server.name, iconURL: CONFIG.server.icon })
                        .setTimestamp()
                    ]
                });
                break;
            }

            case 'balance': {
                const target = options.getUser('utilisateur') || interaction.user;
                const user = queries.user.get.get(target.id);

                if (!user) {
                    await interaction.reply({
                        embeds: [new EmbedBuilder()
                            .setTitle('Erreur')
                            .setDescription('Utilisateur non trouvé dans la base de données.')
                            .setColor(CONFIG.colors.danger)
                        ],
                        ephemeral: true
                    });
                    return;
                }

                await interaction.reply({
                    embeds: [new EmbedBuilder()
                        .setTitle(`Solde de ${target.username}`)
                        .setDescription(`**Pièces :** ${user.coins}\n**Banque :** ${user.bank}\n**Total :** ${user.coins + user.bank}`)
                        .setColor(CONFIG.colors.primary)
                        .setThumbnail(target.displayAvatarURL())
                        .setFooter({ text: CONFIG.server.name, iconURL: CONFIG.server.icon })
                        .setTimestamp()
                    ]
                });
                break;
            }

            case 'daily': {
                const user = queries.user.get.get(interaction.user.id);
                const now = Date.now();

                if (user.last_daily && now - user.last_daily < CONFIG.limits.dailyCooldown) {
                    const remaining = Math.ceil((CONFIG.limits.dailyCooldown - (now - user.last_daily)) / 3600000);
                    await interaction.reply({
                        embeds: [new EmbedBuilder()
                            .setTitle('Erreur')
                            .setDescription(`Tu as déjà réclamé ta récompense quotidienne.\nReviens dans **${remaining} heure(s)**.`)
                            .setColor(CONFIG.colors.danger)
                        ],
                        ephemeral: true
                    });
                    return;
                }

                const reward = Math.floor(Math.random() * 100) + 50;
                addCoins(interaction.user.id, reward, 'daily', 'Récompense quotidienne');
                queries.user.setDaily.run(now, interaction.user.id);

                await interaction.reply({
                    embeds: [new EmbedBuilder()
                        .setTitle('Récompense quotidienne')
                        .setDescription(`Tu as reçu **${reward} pièces** !`)
                        .setColor(CONFIG.colors.success)
                        .setFooter({ text: CONFIG.server.name, iconURL: CONFIG.server.icon })
                        .setTimestamp()
                    ]
                });
                break;
            }

            case 'give': {
                const target = options.getUser('utilisateur');
                const amount = options.getInteger('montant');

                if (target.id === interaction.user.id) {
                    await interaction.reply({
                        embeds: [new EmbedBuilder()
                            .setTitle('Erreur')
                            .setDescription('Tu ne peux pas te donner des pièces à toi-même.')
                            .setColor(CONFIG.colors.danger)
                        ],
                        ephemeral: true
                    });
                    return;
                }

                const sender = queries.user.get.get(interaction.user.id);
                if (!sender || sender.coins < amount) {
                    await interaction.reply({
                        embeds: [new EmbedBuilder()
                            .setTitle('Erreur')
                            .setDescription('Tu n\'as pas assez de pièces.')
                            .setColor(CONFIG.colors.danger)
                        ],
                        ephemeral: true
                    });
                    return;
                }

                const receiver = queries.user.get.get(target.id);
                if (!receiver) {
                    queries.user.create.run(target.id, target.tag);
                }

                addCoins(interaction.user.id, -amount, 'transfer', `Transfert à ${target.tag}`);
                addCoins(target.id, amount, 'receive', `Transfert de ${interaction.user.tag}`);

                await interaction.reply({
                    embeds: [new EmbedBuilder()
                        .setTitle('Transfert effectué')
                        .setDescription(`Tu as donné **${amount} pièces** à ${target}.`)
                        .setColor(CONFIG.colors.success)
                        .setFooter({ text: CONFIG.server.name, iconURL: CONFIG.server.icon })
                        .setTimestamp()
                    ]
                });
                break;
            }

            case 'warn': {
                const target = options.getUser('membre');
                const reason = options.getString('raison');

                const user = queries.user.get.get(target.id);
                if (!user) {
                    queries.user.create.run(target.id, target.tag);
                }

                queries.warning.create.run(target.id, interaction.user.id, reason);
                queries.user.addWarning.run(target.id);

                const updatedUser = queries.user.get.get(target.id);

                await Logger.modLog('Avertissement', target, interaction.user, reason);

                try {
                    await target.send({
                        embeds: [new EmbedBuilder()
                            .setTitle('Avertissement')
                            .setDescription(`Tu as reçu un avertissement sur **${interaction.guild.name}**.\n\n**Raison :** ${reason}\n**Total :** ${updatedUser.warnings}/${CONFIG.limits.maxWarnings}`)
                            .setColor(CONFIG.colors.warning)
                            .setFooter({ text: CONFIG.server.name, iconURL: CONFIG.server.icon })
                            .setTimestamp()
                        ]
                    });
                } catch (e) {}

                await interaction.reply({
                    embeds: [new EmbedBuilder()
                        .setTitle('Avertissement donné')
                        .setDescription(`${target} a été averti.\n**Total :** ${updatedUser.warnings}/${CONFIG.limits.maxWarnings}`)
                        .setColor(CONFIG.colors.success)
                        .setFooter({ text: CONFIG.server.name, iconURL: CONFIG.server.icon })
                        .setTimestamp()
                    ],
                    ephemeral: true
                });
                break;
            }

            case 'warnings': {
                const target = options.getUser('utilisateur');
                const warnings = queries.warning.getByUser.all(target.id);

                if (warnings.length === 0) {
                    await interaction.reply({
                        embeds: [new EmbedBuilder()
                            .setTitle('Avertissements')
                            .setDescription('Aucun avertissement pour cet utilisateur.')
                            .setColor(CONFIG.colors.info)
                        ],
                        ephemeral: true
                    });
                    return;
                }

                const description = warnings.map(w => {
                    return `**${w.reason}** - <t:${Math.floor(new Date(w.created_at).getTime() / 1000)}:R>\nPar <@${w.moderator_id}>`;
                }).join('\n\n');

                await interaction.reply({
                    embeds: [new EmbedBuilder()
                        .setTitle(`Avertissements de ${target.username}`)
                        .setDescription(description)
                        .setColor(CONFIG.colors.warning)
                        .setThumbnail(target.displayAvatarURL())
                        .setFooter({ text: CONFIG.server.name, iconURL: CONFIG.server.icon })
                        .setTimestamp()
                    ],
                    ephemeral: true
                });
                break;
            }

            case 'clear': {
                const amount = options.getInteger('nombre');
                await interaction.channel.bulkDelete(amount, true);

                await interaction.reply({
                    embeds: [new EmbedBuilder()
                        .setTitle('Messages supprimés')
                        .setDescription(`${amount} messages ont été supprimés.`)
                        .setColor(CONFIG.colors.success)
                        .setFooter({ text: CONFIG.server.name, iconURL: CONFIG.server.icon })
                        .setTimestamp()
                    ],
                    ephemeral: true
                });

                await Logger.log(
                    'Messages supprimés',
                    `**${interaction.user.tag}** a supprimé **${amount}** messages dans <#${interaction.channel.id}>.`,
                    CONFIG.colors.warning,
                    [],
                    interaction.user.displayAvatarURL()
                );
                break;
            }

            case 'mute': {
                const target = options.getMember('membre');
                const duration = options.getInteger('durée');

                await target.timeout(duration * 60 * 1000);

                await interaction.reply({
                    embeds: [new EmbedBuilder()
                        .setTitle('Membre mute')
                        .setDescription(`${target} est muet pour ${duration} minutes.`)
                        .setColor(CONFIG.colors.success)
                        .setFooter({ text: CONFIG.server.name, iconURL: CONFIG.server.icon })
                        .setTimestamp()
                    ],
                    ephemeral: true
                });

                await Logger.modLog('Mute', target.user, interaction.user, `${duration} minutes`);
                break;
            }

            case 'unmute': {
                const target = options.getMember('membre');
                await target.timeout(null);

                await interaction.reply({
                    embeds: [new EmbedBuilder()
                        .setTitle('Mute retiré')
                        .setDescription(`Le mute de ${target} a été retiré.`)
                        .setColor(CONFIG.colors.success)
                        .setFooter({ text: CONFIG.server.name, iconURL: CONFIG.server.icon })
                        .setTimestamp()
                    ],
                    ephemeral: true
                });

                await Logger.modLog('Unmute', target.user, interaction.user, 'Mute retiré');
                break;
            }

            case 'ticket': {
                const existingTicket = interaction.guild.channels.cache.find(c => 
                    c.name === `ticket-${interaction.user.username.toLowerCase()}`
                );

                if (existingTicket) {
                    await interaction.reply({
                        embeds: [new EmbedBuilder()
                            .setTitle('Erreur')
                            .setDescription('Tu as déjà un ticket ouvert.')
                            .setColor(CONFIG.colors.danger)
                        ],
                        ephemeral: true
                    });
                    return;
                }

                const ticketChannel = await interaction.guild.channels.create({
                    name: `ticket-${interaction.user.username.toLowerCase()}`,
                    type: ChannelType.GuildText,
                    topic: `Ticket de ${interaction.user.tag}`,
                    permissionOverwrites: [
                        { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                        { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
                        { id: interaction.guild.roles.cache.find(r => r.permissions.has(PermissionFlagsBits.ManageChannels))?.id || interaction.guild.ownerId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }
                    ]
                });

                queries.ticket.create.run(ticketChannel.id, interaction.user.id);

                await ticketChannel.send({
                    content: `${interaction.user}`,
                    embeds: [new EmbedBuilder()
                        .setTitle('Nouveau ticket')
                        .setDescription(`Bonjour ${interaction.user},\n\nUn membre du staff va prendre en charge ta demande.\n\n**Veuillez décrire ton problème ci-dessous.**`)
                        .setColor(CONFIG.colors.primary)
                        .setFooter({ text: CONFIG.server.name, iconURL: CONFIG.server.icon })
                        .setTimestamp()
                    ]
                });

                await interaction.reply({
                    embeds: [new EmbedBuilder()
                        .setTitle('Ticket créé')
                        .setDescription(`Ton ticket a été créé : ${ticketChannel}`)
                        .setColor(CONFIG.colors.success)
                        .setFooter({ text: CONFIG.server.name, iconURL: CONFIG.server.icon })
                        .setTimestamp()
                    ],
                    ephemeral: true
                });

                await Logger.log(
                    'Ticket créé',
                    `**${interaction.user.tag}** a ouvert un ticket : <#${ticketChannel.id}>`,
                    CONFIG.colors.info,
                    [],
                    interaction.user.displayAvatarURL()
                );
                break;
            }

            case 'close': {
                if (!interaction.channel.name.startsWith('ticket-')) {
                    await interaction.reply({
                        embeds: [new EmbedBuilder()
                            .setTitle('Erreur')
                            .setDescription('Cette commande ne fonctionne que dans un ticket.')
                            .setColor(CONFIG.colors.danger)
                        ],
                        ephemeral: true
                    });
                    return;
                }

                queries.ticket.close.run('closed', interaction.user.id, interaction.channel.id);

                await interaction.reply({
                    embeds: [new EmbedBuilder()
                        .setTitle('Fermeture en cours')
                        .setDescription('Le ticket sera fermé dans 5 secondes...')
                        .setColor(CONFIG.colors.warning)
                        .setFooter({ text: CONFIG.server.name, iconURL: CONFIG.server.icon })
                        .setTimestamp()
                    ],
                    ephemeral: true
                });

                setTimeout(async () => {
                    await interaction.channel.delete();
                    await Logger.log(
                        'Ticket fermé',
                        `Le ticket **${interaction.channel.name}** a été fermé par **${interaction.user.tag}**.`,
                        CONFIG.colors.warning,
                        [],
                        interaction.user.displayAvatarURL()
                    );
                }, 5000);
                break;
            }

            case 'tag': {
                const name = options.getString('nom');
                const tag = queries.tag.get.get(name);

                if (!tag) {
                    await interaction.reply({
                        embeds: [new EmbedBuilder()
                            .setTitle('Erreur')
                            .setDescription('Cette étiquette n\'existe pas.')
                            .setColor(CONFIG.colors.danger)
                        ],
                        ephemeral: true
                    });
                    return;
                }

                queries.tag.incrementUses.run(name);
                await interaction.reply(tag.content);
                break;
            }

            case 'tagadd': {
                const name = options.getString('nom');
                const content = options.getString('contenu');

                try {
                    queries.tag.create.run(name, content, interaction.user.id);
                    await interaction.reply({
                        embeds: [new EmbedBuilder()
                            .setTitle('Étiquette créée')
                            .setDescription(`L'étiquette **${name}** a été créée.`)
                            .setColor(CONFIG.colors.success)
                            .setFooter({ text: CONFIG.server.name, iconURL: CONFIG.server.icon })
                            .setTimestamp()
                        ],
                        ephemeral: true
                    });
                } catch (e) {
                    await interaction.reply({
                        embeds: [new EmbedBuilder()
                            .setTitle('Erreur')
                            .setDescription('Cette étiquette existe déjà.')
                            .setColor(CONFIG.colors.danger)
                        ],
                        ephemeral: true
                    });
                }
                break;
            }

            case 'tagdelete': {
                const name = options.getString('nom');
                queries.tag.delete.run(name);

                await interaction.reply({
                    embeds: [new EmbedBuilder()
                        .setTitle('Étiquette supprimée')
                        .setDescription(`L'étiquette **${name}** a été supprimée.`)
                        .setColor(CONFIG.colors.success)
                        .setFooter({ text: CONFIG.server.name, iconURL: CONFIG.server.icon })
                        .setTimestamp()
                    ],
                    ephemeral: true
                });
                break;
            }

            case 'ccadd': {
                const name = options.getString('nom');
                const response = options.getString('réponse');

                try {
                    queries.command.create.run(name, response, interaction.user.id);
                    await interaction.reply({
                        embeds: [new EmbedBuilder()
                            .setTitle('Commande créée')
                            .setDescription(`La commande **!${name}** a été créée.`)
                            .setColor(CONFIG.colors.success)
                            .setFooter({ text: CONFIG.server.name, iconURL: CONFIG.server.icon })
                            .setTimestamp()
                        ],
                        ephemeral: true
                    });
                } catch (e) {
                    await interaction.reply({
                        embeds: [new EmbedBuilder()
                            .setTitle('Erreur')
                            .setDescription('Cette commande existe déjà.')
                            .setColor(CONFIG.colors.danger)
                        ],
                        ephemeral: true
                    });
                }
                break;
            }

            case 'ccdelete': {
                const name = options.getString('nom');
                queries.command.delete.run(name);

                await interaction.reply({
                    embeds: [new EmbedBuilder()
                        .setTitle('Commande supprimée')
                        .setDescription(`La commande **!${name}** a été supprimée.`)
                        .setColor(CONFIG.colors.success)
                        .setFooter({ text: CONFIG.server.name, iconURL: CONFIG.server.icon })
                        .setTimestamp()
                    ],
                    ephemeral: true
                });
                break;
            }

            case 'remind': {
                const minutes = options.getInteger('minutes');
                const message = options.getString('message');
                const expiresAt = Math.floor(Date.now() / 1000) + (minutes * 60);

                queries.reminder.create.run(interaction.user.id, message, expiresAt);

                await interaction.reply({
                    embeds: [new EmbedBuilder()
                        .setTitle('Rappel défini')
                        .setDescription(`Tu seras notifié dans **${minutes} minute(s)** pour : "${message}"`)
                        .setColor(CONFIG.colors.success)
                        .setFooter({ text: CONFIG.server.name, iconURL: CONFIG.server.icon })
                        .setTimestamp()
                    ],
                    ephemeral: true
                });
                break;
            }

            case 'giveaway': {
                const prize = options.getString('prix');
                const duration = options.getInteger('durée');
                const winners = options.getInteger('gagnants');

                const endsAt = Math.floor(Date.now() / 1000) + (duration * 60);

                const embed = new EmbedBuilder()
                    .setTitle('Giveaway')
                    .setDescription(`**Prix :** ${prize}\n**Durée :** ${duration} minutes\n**Gagnants :** ${winners}\n\nRéagis avec 🎉 pour participer !`)
                    .setColor(CONFIG.colors.primary)
                    .setFooter({ text: `Se termine`, iconURL: CONFIG.server.icon })
                    .setTimestamp(endsAt * 1000);

                const message = await interaction.channel.send({ embeds: [embed] });
                await message.react('🎉');

                queries.giveaway.create.run(message.id, interaction.channel.id, interaction.user.id, prize, winners, endsAt);

                await interaction.reply({
                    embeds: [new EmbedBuilder()
                        .setTitle('Giveaway créé')
                        .setDescription(`Giveaway pour **${prize}** lancé !`)
                        .setColor(CONFIG.colors.success)
                        .setFooter({ text: CONFIG.server.name, iconURL: CONFIG.server.icon })
                        .setTimestamp()
                    ],
                    ephemeral: true
                });
                break;
            }

            case 'userinfo': {
                const member = options.getMember('membre') || interaction.member;
                const user = queries.user.get.get(member.id);

                const roles = member.roles.cache.filter(r => r.id !== member.guild.id).map(r => r.name).join(', ') || 'Aucun';

                const embed = new EmbedBuilder()
                    .setTitle(`Informations de ${member.user.username}`)
                    .setColor(CONFIG.colors.primary)
                    .setThumbnail(member.user.displayAvatarURL())
                    .addFields(
                        { name: 'Pseudo', value: member.displayName, inline: true },
                        { name: 'Identifiant', value: member.id, inline: true },
                        { name: 'Compte créé', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:D>`, inline: true },
                        { name: 'A rejoint le', value: member.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:D>` : 'Inconnu', inline: true },
                        { name: 'Rôles', value: roles.substring(0, 1000), inline: false }
                    )
                    .setFooter({ text: CONFIG.server.name, iconURL: CONFIG.server.icon })
                    .setTimestamp();

                if (user) {
                    embed.addFields(
                        { name: 'Niveau', value: `${user.level}`, inline: true },
                        { name: 'XP', value: `${user.xp}/${calculateXP(user.level)}`, inline: true },
                        { name: 'Pièces', value: `${user.coins}`, inline: true },
                        { name: 'Avertissements', value: `${user.warnings}`, inline: true }
                    );
                }

                await interaction.reply({ embeds: [embed] });
                break;
            }

            case 'serverinfo': {
                const guild = interaction.guild;

                await interaction.reply({
                    embeds: [new EmbedBuilder()
                        .setTitle(`Informations du serveur`)
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
                        .setTimestamp()
                    ]
                });
                break;
            }

            case 'scan': {
                await interaction.deferReply({ ephemeral: true });

                const guild = interaction.guild;
                const items = [];

                items.push({
                    _type: 'server_info',
                    id: guild.id,
                    name: guild.name,
                    ownerId: guild.ownerId,
                    memberCount: guild.memberCount,
                    createdAt: guild.createdAt.toISOString()
                });

                guild.channels.cache.forEach(ch => {
                    items.push({
                        _type: 'channel',
                        id: ch.id,
                        name: ch.name,
                        type: ChannelType[ch.type],
                        parentId: ch.parentId
                    });
                });

                guild.roles.cache.forEach(role => {
                    items.push({
                        _type: 'role',
                        id: role.id,
                        name: role.name,
                        color: role.hexColor,
                        position: role.position
                    });
                });

                guild.members.cache.forEach(member => {
                    items.push({
                        _type: 'member',
                        id: member.id,
                        username: member.user.username,
                        displayName: member.displayName,
                        roles: member.roles.cache.filter(r => r.id !== guild.id).map(r => r.name)
                    });
                });

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
                    const metaData = {
                        _meta: {
                            file: i + 1,
                            total_files: 5,
                            server: guild.name,
                            timestamp: new Date().toISOString(),
                            item_count: buckets[i].items.length,
                            estimated_size_kb: Math.round(buckets[i].size / 1024)
                        },
                        data: buckets[i].items
                    };

                    files.push({
                        attachment: Buffer.from(JSON.stringify(metaData, null, 2), 'utf-8'),
                        name: `scan_partie_${i + 1}_sur_5_${safeName}_${timestamp}.json`
                    });
                }

                await interaction.followUp({
                    embeds: [new EmbedBuilder()
                        .setTitle('Analyse terminée')
                        .setDescription('L\'analyse a généré **5 fichiers JSON** contenant toutes les informations du serveur.')
                        .setColor(CONFIG.colors.success)
                        .setFooter({ text: CONFIG.server.name, iconURL: CONFIG.server.icon })
                        .setTimestamp()
                    ],
                    files: files,
                    ephemeral: true
                });
                break;
            }

            default: {
                await interaction.reply({
                    embeds: [new EmbedBuilder()
                        .setTitle('Erreur')
                        .setDescription('Commande non reconnue.')
                        .setColor(CONFIG.colors.danger)
                    ],
                    ephemeral: true
                });
            }
        }
    } catch (error) {
        Logger.error(`Erreur commande ${commandName}: ${error.message}`);
        
        const reply = {
            embeds: [new EmbedBuilder()
                .setTitle('Erreur')
                .setDescription('Une erreur est survenue lors de l\'exécution de cette commande.')
                .setColor(CONFIG.colors.danger)
            ],
            ephemeral: true
        };

        if (interaction.replied || interaction.deferred) {
            await interaction.followUp(reply);
        } else {
            await interaction.reply(reply);
        }
    }
});

// ==========================================
// DÉMARRAGE
// ==========================================
async function start() {
    try {
        await rest.put(Routes.applicationGuildCommands(client.user.id, CONFIG.server.id), { body: commands.map(cmd => cmd.toJSON()) });
        Logger.success('Commandes enregistrées avec succès');

        await client.login(process.env.DISCORD_TOKEN);
        Logger.success('Connexion Discord établie');

        app.listen(PORT, HOST, () => {
            Logger.success(`Serveur API actif sur http://${HOST}:${PORT}`);
        });
    } catch (error) {
        Logger.error(`Erreur de démarrage: ${error.message}`);
        process.exit(1);
    }
}

process.on('uncaughtException', (error) => {
    Logger.error(`Exception non capturée: ${error.message}`);
    console.error(error);
});

process.on('unhandledRejection', (reason) => {
    Logger.error(`Promesse rejetée non gérée: ${reason}`);
    console.error(reason);
});

start();
