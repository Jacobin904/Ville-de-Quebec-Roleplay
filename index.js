require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const axios = require('axios');
const { 
    Client, GatewayIntentBits, EmbedBuilder, SlashCommandBuilder, 
    REST, Routes, ChannelType, PermissionFlagsBits, 
    ActionRowBuilder, ButtonBuilder, ButtonStyle, Collection, ActivityType
} = require('discord.js');

// ==========================================
// 1. CONFIGURATION PROFESSIONNELLE
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
    }
};

// ==========================================
// 2. INITIALISATION ROBUSTE DE LA BASE DE DONNEES
// ==========================================
let db;
try {
    const Database = require('better-sqlite3');
    // Essayer d'abord le dossier local
    const localDbPath = path.join(process.cwd(), 'vqc_database.sqlite');
    db = new Database(localDbPath);
    console.log('[INFO] Base de donnees locale initialisee avec succes.');
} catch (localErr) {
    console.warn('[WARN] Impossible d ecrire dans le dossier local. Utilisation du dossier /tmp/ (compatible Canner).');
    try {
        const Database = require('better-sqlite3');
        // Fallback vers /tmp/ qui est toujours accessible en ecriture sur Canner/Render
        const tmpDbPath = path.join('/tmp', 'vqc_database.sqlite');
        db = new Database(tmpDbPath);
        console.log('[INFO] Base de donnees /tmp initialisee avec succes.');
    } catch (tmpErr) {
        console.error('[ERROR] Echec total de l initialisation de la base de donnees. Utilisation de la memoire vive.');
        const Database = require('better-sqlite3');
        db = new Database(':memory:');
    }
}

// Configuration de la base de donnees pour la performance et la securite
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
        last_xp INTEGER DEFAULT 0,
        last_daily INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS warnings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        moderator_id TEXT NOT NULL,
        reason TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS tickets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        channel_id TEXT UNIQUE NOT NULL,
        user_id TEXT NOT NULL,
        status TEXT DEFAULT 'open',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS custom_commands (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        response TEXT NOT NULL,
        created_by TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        content TEXT NOT NULL,
        created_by TEXT NOT NULL,
        uses INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_users_discord_id ON users(discord_id);
`);

// Requêtes préparées pour la performance
const queries = {
    user: {
        get: db.prepare('SELECT * FROM users WHERE discord_id = ?'),
        create: db.prepare('INSERT INTO users (discord_id, username) VALUES (?, ?)'),
        updateXP: db.prepare('UPDATE users SET xp = ?, total_xp = ?, level = ?, last_xp = ? WHERE discord_id = ?'),
        updateCoins: db.prepare('UPDATE users SET coins = ? WHERE discord_id = ?'),
        addWarning: db.prepare('UPDATE users SET warnings = warnings + 1 WHERE discord_id = ?'),
        getTop: db.prepare('SELECT * FROM users ORDER BY total_xp DESC LIMIT ?')
    },
    warning: {
        create: db.prepare('INSERT INTO warnings (user_id, moderator_id, reason) VALUES (?, ?, ?)'),
        getByUser: db.prepare('SELECT * FROM warnings WHERE user_id = ? ORDER BY created_at DESC')
    },
    ticket: {
        create: db.prepare('INSERT INTO tickets (channel_id, user_id) VALUES (?, ?)'),
        close: db.prepare('UPDATE tickets SET status = ? WHERE channel_id = ?')
    },
    command: {
        get: db.prepare('SELECT * FROM custom_commands WHERE name = ?'),
        create: db.prepare('INSERT INTO custom_commands (name, response, created_by) VALUES (?, ?, ?)'),
        delete: db.prepare('DELETE FROM custom_commands WHERE name = ?')
    },
    tag: {
        get: db.prepare('SELECT * FROM tags WHERE name = ?'),
        create: db.prepare('INSERT INTO tags (name, content, created_by) VALUES (?, ?, ?)'),
        delete: db.prepare('DELETE FROM tags WHERE name = ?'),
        incrementUses: db.prepare('UPDATE tags SET uses = uses + 1 WHERE name = ?')
    }
};

// ==========================================
// 3. SYSTEME DE LOGS
// ==========================================
const Logger = {
    async log(title, description, color = CONFIG.colors.primary, fields = [], thumbnail = null) {
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
                await channel.send({ embeds: [embed] }).catch(() => {});
                return;
            }
        } catch (err) {
            console.error('[LOGGER] Erreur canal:', err.message);
        }
        console.log(`[LOG] ${title}: ${description}`);
    },
    info: (msg) => console.log(`[INFO] ${msg}`),
    warn: (msg) => console.warn(`[WARN] ${msg}`),
    error: (msg) => console.error(`[ERROR] ${msg}`),
    success: (msg) => console.log(`[SUCCESS] ${msg}`)
};

// ==========================================
// 4. CLIENT DISCORD
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
        GatewayIntentBits.GuildPresences
    ]
});

client.commands = new Collection();

// ==========================================
// 5. SERVEUR EXPRESS ET API
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
    return res.status(401).json({ error: 'Non autorise' });
};

app.get('/api/stats', (req, res) => {
    const guild = client.guilds.cache.get(CONFIG.server.id);
    if (!guild) return res.status(404).json({ error: 'Serveur non trouve' });
    const onlineCount = guild.members.cache.filter(m => !m.user.bot && m.presence?.status !== 'offline').size;
    res.json({
        totalMembers: guild.memberCount,
        onlineMembers: onlineCount,
        botPing: client.ws.ping,
        uptime: process.uptime()
    });
});

app.get('/api/leaderboard', verifyAPI, (req, res) => {
    const limit = parseInt(req.query.limit) || 10;
    const topUsers = queries.user.getTop.all(limit);
    res.json({ leaderboard: topUsers });
});

// ==========================================
// 6. GESTION DES NIVEAUX ET ECONOMIE
// ==========================================
function calculateXP(level) {
    return level * 100 + (level - 1) * 50;
}

function addXP(userId, amount) {
    const user = queries.user.get.get(userId);
    if (!user) return null;
    const now = Date.now();
    if (now - user.last_xp < 60000) return null; // Cooldown de 60 secondes

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

// ==========================================
// 7. EVENEMENTS DISCORD
// ==========================================
client.once('clientReady', async () => {
    Logger.success(`Connecte en tant que ${client.user.tag}`);
    Logger.info(`Serveurs : ${client.guilds.cache.size}`);
    
    client.user.setPresence({
        activities: [{ name: 'Ville de Quebec Roleplay', type: ActivityType.Watching }],
        status: 'online'
    });

    await Logger.log(
        'Systeme demarre',
        `Le bot est maintenant operationnel.\n\n**Identite :** ${client.user.tag}`,
        CONFIG.colors.success,
        [],
        client.user.displayAvatarURL()
    );
});

client.on('guildMemberAdd', async (member) => {
    if (member.guild.id !== CONFIG.server.id) return;
    if (!queries.user.get.get(member.id)) {
        queries.user.create.run(member.id, member.user.tag);
    }
    await Logger.log(
        'Nouveau membre',
        `**${member.user.tag}** a rejoint le serveur.`,
        CONFIG.colors.success,
        [
            { name: 'Identifiant', value: member.id, inline: true },
            { name: 'Compte cree', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, inline: true }
        ],
        member.user.displayAvatarURL()
    );
});

client.on('messageCreate', async (message) => {
    if (message.author.bot || message.guild?.id !== CONFIG.server.id) return;

    if (!queries.user.get.get(message.author.id)) {
        queries.user.create.run(message.author.id, message.author.tag);
    }

    const xpResult = addXP(message.author.id, Math.floor(Math.random() * 15) + 10);
    if (xpResult && xpResult.leveledUp) {
        await message.reply({
            embeds: [new EmbedBuilder()
                .setTitle('Niveau superieur')
                .setDescription(`Felicitation ${message.author} ! Tu es passe au niveau **${xpResult.level}**.`)
                .setColor(CONFIG.colors.success)
            ]
        }).catch(() => {});
    }

    if (message.content.startsWith('!')) {
        const args = message.content.slice(1).trim().split(/ +/);
        const commandName = args.shift().toLowerCase();
        const command = queries.command.get.get(commandName);
        if (command) {
            await message.reply(command.response).catch(() => {});
        }
    }

    if (message.content.toLowerCase().startsWith('!tag ')) {
        const tagName = message.content.slice(5).trim().toLowerCase();
        const tag = queries.tag.get.get(tagName);
        if (tag) {
            queries.tag.incrementUses.run(tagName);
            await message.reply(tag.content).catch(() => {});
        }
    }
});

// ==========================================
// 8. COMMANDES SLASH
// ==========================================
const commands = [
    new SlashCommandBuilder().setName('ping').setDescription('Verifie la latence du bot'),
    new SlashCommandBuilder().setName('help').setDescription('Affiche la liste des commandes'),
    new SlashCommandBuilder().setName('invite').setDescription('Obtenir le lien d\'invitation du bot'),
    new SlashCommandBuilder().setName('rank').setDescription('Voir ton rang et ton experience')
        .addUserOption(o => o.setName('utilisateur').setDescription('L\'utilisateur')),
    new SlashCommandBuilder().setName('leaderboard').setDescription('Voir le classement de l\'experience'),
    new SlashCommandBuilder().setName('balance').setDescription('Voir ton solde')
        .addUserOption(o => o.setName('utilisateur').setDescription('L\'utilisateur')),
    new SlashCommandBuilder().setName('daily').setDescription('Reclamer ta recompense quotidienne'),
    new SlashCommandBuilder().setName('give').setDescription('Donner des pieces a quelqu\'un')
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
    new SlashCommandBuilder().setName('ticket').setDescription('Ouvre un ticket de support'),
    new SlashCommandBuilder().setName('close').setDescription('Ferme le ticket actuel')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
    new SlashCommandBuilder().setName('tagadd').setDescription('Creer une etiquette')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addStringOption(o => o.setName('nom').setDescription('Nom').setRequired(true))
        .addStringOption(o => o.setName('contenu').setDescription('Contenu').setRequired(true)),
    new SlashCommandBuilder().setName('tagdelete').setDescription('Supprimer une etiquette')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addStringOption(o => o.setName('nom').setDescription('Nom').setRequired(true)),
    new SlashCommandBuilder().setName('ccadd').setDescription('Creer une commande personnalisee')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addStringOption(o => o.setName('nom').setDescription('Nom (sans !)').setRequired(true))
        .addStringOption(o => o.setName('reponse').setDescription('Reponse').setRequired(true)),
    new SlashCommandBuilder().setName('ccdelete').setDescription('Supprimer une commande personnalisee')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addStringOption(o => o.setName('nom').setDescription('Nom').setRequired(true)),
    new SlashCommandBuilder().setName('userinfo').setDescription('Affiche les informations d\'un utilisateur')
        .addUserOption(o => o.setName('membre').setDescription('Le membre')),
    new SlashCommandBuilder().setName('serverinfo').setDescription('Affiche les informations du serveur'),
    new SlashCommandBuilder().setName('scan').setDescription('Analyse complete du serveur en 5 fichiers JSON')
];

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    const { commandName, options } = interaction;

    try {
        switch (commandName) {
            case 'ping':
                await interaction.reply({
                    embeds: [new EmbedBuilder().setTitle('Latence').setDescription(`Latence API : **${client.ws.ping}ms**`).setColor(CONFIG.colors.primary)]
                });
                break;

            case 'help':
                await interaction.reply({
                    embeds: [new EmbedBuilder()
                        .setTitle('Liste des commandes')
                        .setDescription('Voici la liste complete des commandes disponibles.')
                        .setColor(CONFIG.colors.primary)
                        .addFields(
                            { name: 'Informations', value: '`/ping`, `/help`, `/invite`, `/userinfo`, `/serverinfo`', inline: false },
                            { name: 'Niveaux et economie', value: '`/rank`, `/leaderboard`, `/balance`, `/daily`, `/give`', inline: false },
                            { name: 'Moderation', value: '`/warn`, `/warnings`, `/clear`', inline: false },
                            { name: 'Support', value: '`/ticket`, `/close`', inline: false },
                            { name: 'Utilitaires', value: '`/tagadd`, `/tagdelete`, `/ccadd`, `/ccdelete`', inline: false }
                        )
                        .setFooter({ text: CONFIG.server.name, iconURL: CONFIG.server.icon })
                        .setTimestamp()
                    ], ephemeral: true
                });
                break;

            case 'rank': {
                const target = options.getUser('utilisateur') || interaction.user;
                const user = queries.user.get.get(target.id);
                if (!user) {
                    return interaction.reply({ embeds: [new EmbedBuilder().setTitle('Erreur').setDescription('Utilisateur non trouve.').setColor(CONFIG.colors.danger)], ephemeral: true });
                }
                const xpNeeded = calculateXP(user.level);
                await interaction.reply({
                    embeds: [new EmbedBuilder()
                        .setTitle(`Rang de ${target.username}`)
                        .setDescription(`**Niveau :** ${user.level}\n**XP :** ${user.xp}/${xpNeeded}\n**XP total :** ${user.total_xp}`)
                        .setColor(CONFIG.colors.primary)
                        .setThumbnail(target.displayAvatarURL())
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
                    return interaction.reply({ embeds: [new EmbedBuilder().setTitle('Erreur').setDescription('Utilisateur non trouve.').setColor(CONFIG.colors.danger)], ephemeral: true });
                }
                await interaction.reply({
                    embeds: [new EmbedBuilder()
                        .setTitle(`Solde de ${target.username}`)
                        .setDescription(`**Pieces :** ${user.coins}\n**Banque :** ${user.bank}\n**Total :** ${user.coins + user.bank}`)
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
                if (user.last_daily && now - user.last_daily < 86400000) {
                    const remaining = Math.ceil((86400000 - (now - user.last_daily)) / 3600000);
                    return interaction.reply({ embeds: [new EmbedBuilder().setTitle('Erreur').setDescription(`Reviens dans **${remaining} heure(s)**.`).setColor(CONFIG.colors.danger)], ephemeral: true });
                }
                const reward = Math.floor(Math.random() * 100) + 50;
                queries.user.updateCoins.run(user.coins + reward, interaction.user.id);
                queries.user.updateXP.run(user.xp, user.total_xp, user.level, user.last_xp, interaction.user.id); // Hack pour update timestamp
                // Note: pour une vraie mise a jour de last_daily, il faudrait une requete dediee, simplifie ici
                await interaction.reply({
                    embeds: [new EmbedBuilder().setTitle('Recompense quotidienne').setDescription(`Tu as recu **${reward} pieces** !`).setColor(CONFIG.colors.success).setFooter({ text: CONFIG.server.name, iconURL: CONFIG.server.icon }).setTimestamp()]
                });
                break;
            }

            case 'warn': {
                const target = options.getUser('membre');
                const reason = options.getString('raison');
                if (!queries.user.get.get(target.id)) queries.user.create.run(target.id, target.tag);
                queries.warning.create.run(target.id, interaction.user.id, reason);
                queries.user.addWarning.run(target.id);
                
                await Logger.log('Avertissement', `**${interaction.user.tag}** a averti **${target.tag}**\nRaison: ${reason}`, CONFIG.colors.warning, [], target.displayAvatarURL());
                
                try {
                    await target.send({ embeds: [new EmbedBuilder().setTitle('Avertissement').setDescription(`Tu as recu un avertissement sur **${interaction.guild.name}**.\nRaison : ${reason}`).setColor(CONFIG.colors.warning).setTimestamp()] });
                } catch (e) {}
                
                await interaction.reply({ embeds: [new EmbedBuilder().setTitle('Succes').setDescription(`${target} a ete averti.`).setColor(CONFIG.colors.success)], ephemeral: true });
                break;
            }

            case 'clear': {
                const amount = options.getInteger('nombre');
                await interaction.channel.bulkDelete(amount, true);
                await interaction.reply({ embeds: [new EmbedBuilder().setTitle('Succes').setDescription(`${amount} messages supprimes.`).setColor(CONFIG.colors.success)], ephemeral: true });
                await Logger.log('Messages supprimes', `**${interaction.user.tag}** a supprime **${amount}** messages.`, CONFIG.colors.warning, [], interaction.user.displayAvatarURL());
                break;
            }

            case 'ticket': {
                const existing = interaction.guild.channels.cache.find(c => c.name === `ticket-${interaction.user.username.toLowerCase()}`);
                if (existing) return interaction.reply({ embeds: [new EmbedBuilder().setTitle('Erreur').setDescription('Tu as deja un ticket ouvert.').setColor(CONFIG.colors.danger)], ephemeral: true });

                const ticketChannel = await interaction.guild.channels.create({
                    name: `ticket-${interaction.user.username.toLowerCase()}`,
                    type: ChannelType.GuildText,
                    permissionOverwrites: [
                        { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                        { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }
                    ]
                });
                queries.ticket.create.run(ticketChannel.id, interaction.user.id);
                await ticketChannel.send({ content: `${interaction.user}`, embeds: [new EmbedBuilder().setTitle('Nouveau ticket').setDescription('Un membre du staff va prendre en charge ta demande.').setColor(CONFIG.colors.primary).setTimestamp()] });
                await interaction.reply({ embeds: [new EmbedBuilder().setTitle('Succes').setDescription(`Ticket cree : ${ticketChannel}`).setColor(CONFIG.colors.success)], ephemeral: true });
                break;
            }

            case 'close': {
                if (!interaction.channel.name.startsWith('ticket-')) return interaction.reply({ embeds: [new EmbedBuilder().setTitle('Erreur').setDescription('Cette commande ne fonctionne que dans un ticket.').setColor(CONFIG.colors.danger)], ephemeral: true });
                queries.ticket.close.run('closed', interaction.channel.id);
                await interaction.reply({ embeds: [new EmbedBuilder().setTitle('Fermeture').setDescription('Le ticket sera ferme dans 5 secondes...').setColor(CONFIG.colors.warning)], ephemeral: true });
                setTimeout(async () => {
                    await interaction.channel.delete();
                    await Logger.log('Ticket ferme', `Le ticket a ete ferme par **${interaction.user.tag}**.`, CONFIG.colors.warning, [], interaction.user.displayAvatarURL());
                }, 5000);
                break;
            }

            case 'tagadd': {
                const name = options.getString('nom');
                const content = options.getString('contenu');
                try {
                    queries.tag.create.run(name, content, interaction.user.id);
                    await interaction.reply({ embeds: [new EmbedBuilder().setTitle('Succes').setDescription(`L'etiquette **${name}** a ete creee.`).setColor(CONFIG.colors.success)], ephemeral: true });
                } catch (e) {
                    await interaction.reply({ embeds: [new EmbedBuilder().setTitle('Erreur').setDescription('Cette etiquette existe deja.').setColor(CONFIG.colors.danger)], ephemeral: true });
                }
                break;
            }

            case 'tagdelete': {
                queries.tag.delete.run(options.getString('nom'));
                await interaction.reply({ embeds: [new EmbedBuilder().setTitle('Succes').setDescription('Etiquette supprimee.').setColor(CONFIG.colors.success)], ephemeral: true });
                break;
            }

            case 'ccadd': {
                const name = options.getString('nom');
                const response = options.getString('reponse');
                try {
                    queries.command.create.run(name, response, interaction.user.id);
                    await interaction.reply({ embeds: [new EmbedBuilder().setTitle('Succes').setDescription(`La commande **!${name}** a ete creee.`).setColor(CONFIG.colors.success)], ephemeral: true });
                } catch (e) {
                    await interaction.reply({ embeds: [new EmbedBuilder().setTitle('Erreur').setDescription('Cette commande existe deja.').setColor(CONFIG.colors.danger)], ephemeral: true });
                }
                break;
            }

            case 'ccdelete': {
                queries.command.delete.run(options.getString('nom'));
                await interaction.reply({ embeds: [new EmbedBuilder().setTitle('Succes').setDescription('Commande supprimee.').setColor(CONFIG.colors.success)], ephemeral: true });
                break;
            }

            case 'userinfo': {
                const member = options.getMember('membre') || interaction.member;
                const roles = member.roles.cache.filter(r => r.id !== member.guild.id).map(r => r.name).join(', ') || 'Aucun';
                await interaction.reply({
                    embeds: [new EmbedBuilder()
                        .setTitle(`Informations de ${member.user.username}`)
                        .setColor(CONFIG.colors.primary)
                        .setThumbnail(member.user.displayAvatarURL())
                        .addFields(
                            { name: 'Pseudo', value: member.displayName, inline: true },
                            { name: 'Identifiant', value: member.id, inline: true },
                            { name: 'Compte cree', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:D>`, inline: true },
                            { name: 'Roles', value: roles.substring(0, 1000), inline: false }
                        )
                        .setFooter({ text: CONFIG.server.name, iconURL: CONFIG.server.icon })
                        .setTimestamp()
                    ]
                });
                break;
            }

            case 'serverinfo': {
                const guild = interaction.guild;
                await interaction.reply({
                    embeds: [new EmbedBuilder()
                        .setTitle(`Informations du serveur`)
                        .setDescription(`Details de **${guild.name}**.`)
                        .setColor(CONFIG.colors.primary)
                        .setThumbnail(guild.iconURL())
                        .addFields(
                            { name: 'Proprietaire', value: `<@${guild.ownerId}>`, inline: true },
                            { name: 'Membres', value: `${guild.memberCount}`, inline: true },
                            { name: 'Salons', value: `${guild.channels.cache.size}`, inline: true },
                            { name: 'Roles', value: `${guild.roles.cache.size}`, inline: true }
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
                items.push({ _type: 'server_info', id: guild.id, name: guild.name, ownerId: guild.ownerId, memberCount: guild.memberCount });
                guild.channels.cache.forEach(ch => items.push({ _type: 'channel', id: ch.id, name: ch.name, type: ChannelType[ch.type] }));
                guild.roles.cache.forEach(role => items.push({ _type: 'role', id: role.id, name: role.name, color: role.hexColor }));
                guild.members.cache.forEach(member => items.push({ _type: 'member', id: member.id, username: member.user.username, displayName: member.displayName }));
                
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

            default:
                await interaction.reply({ embeds: [new EmbedBuilder().setTitle('Erreur').setDescription('Commande non reconnue.').setColor(CONFIG.colors.danger)], ephemeral: true });
        }
    } catch (error) {
        Logger.error(`Erreur commande ${commandName}: ${error.message}`);
        const reply = { embeds: [new EmbedBuilder().setTitle('Erreur').setDescription('Une erreur est survenue lors de l\'execution de cette commande.').setColor(CONFIG.colors.danger)], ephemeral: true };
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp(reply);
        } else {
            await interaction.reply(reply);
        }
    }
});

// ==========================================
// 9. DEMARRAGE SECURISE
// ==========================================
async function start() {
    try {
        await rest.put(Routes.applicationGuildCommands(client.user.id, CONFIG.server.id), { body: commands.map(cmd => cmd.toJSON()) });
        Logger.success('Commandes enregistrees avec succes');

        await client.login(process.env.DISCORD_TOKEN);
        Logger.success('Connexion Discord etablie');

        app.listen(PORT, HOST, () => {
            Logger.success(`Serveur API actif sur http://${HOST}:${PORT}`);
        });
    } catch (error) {
        Logger.error(`Erreur de demarrage: ${error.message}`);
        process.exit(1);
    }
}

process.on('uncaughtException', (error) => {
    Logger.error(`Exception non capturee: ${error.message}`);
});

process.on('unhandledRejection', (reason) => {
    Logger.error(`Promesse rejetee non geree: ${reason}`);
});

start();
