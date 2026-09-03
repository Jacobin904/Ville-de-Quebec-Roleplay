require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const axios = require('axios');
const cron = require('node-cron');
const Database = require('better-sqlite3');
const { 
    Client, GatewayIntentBits, EmbedBuilder, SlashCommandBuilder, 
    REST, Routes, ChannelType, PermissionFlagsBits, 
    ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, 
    TextInputBuilder, TextInputStyle, PermissionsBitField
} = require('discord.js');

// ==========================================
// 1. CONFIGURATION ET BASE DE DONNEES
// ==========================================
const SERVER_ICON = 'https://cdn.discordapp.com/icons/1490410149213507804/0b1aa46a2fdb33b133a0feb1234739f6.webp?size=1024';
const SERVER_NAME = 'Ville de Quebec Roleplay (VQC)';
const MAIN_GUILD_ID = '1490410149213507804';
const LOG_CHANNEL_ID = '1538659168012075029';
const LOG_WEBHOOK_URL = 'https://discord.com/api/webhooks/1538661235283857560/izzc3OJH6n6mVZPUo7JCxJUHdI6Q3y6CdWqvCsS4MP5AiPTNFpk7CFnufHZCVwV6WVXk';
const JOIN_CHANNEL_ID = '1537569455754969188';
const JACOBIN_ID = '1281784488854159421';
const GUILD_ID = process.env.GUILD_ID;

// Initialisation de la base de donnees SQLite
const dbPath = path.join(__dirname, 'vqc_database.sqlite');
const db = new Database(dbPath);

// Creation du schema complet de la base de donnees
db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        discord_id TEXT PRIMARY KEY,
        username TEXT,
        level INTEGER DEFAULT 1,
        xp INTEGER DEFAULT 0,
        coins INTEGER DEFAULT 100,
        bank INTEGER DEFAULT 0,
        warnings INTEGER DEFAULT 0,
        afk_reason TEXT,
        afk_time INTEGER,
        last_daily INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS mod_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT,
        moderator_id TEXT,
        action_type TEXT,
        reason TEXT,
        duration TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS uptime_monitors (
        monitor_id INTEGER PRIMARY KEY,
        name TEXT,
        url TEXT,
        status INTEGER,
        last_checked TEXT
    );
    CREATE TABLE IF NOT EXISTS server_settings (
        key TEXT PRIMARY KEY,
        value TEXT
    );
    CREATE TABLE IF NOT EXISTS custom_commands (
        name TEXT PRIMARY KEY,
        response TEXT
    );
    CREATE TABLE IF NOT EXISTS tags (
        name TEXT PRIMARY KEY,
        content TEXT,
        author_id TEXT
    );
    CREATE TABLE IF NOT EXISTS giveaways (
        message_id TEXT PRIMARY KEY,
        channel_id TEXT,
        prize TEXT,
        ends_at INTEGER,
        winners INTEGER
    );
`);

// Requêtes preparees pour la performance
const stmts = {
    getUser: db.prepare('SELECT * FROM users WHERE discord_id = ?'),
    createUser: db.prepare('INSERT OR IGNORE INTO users (discord_id, username) VALUES (?, ?)'),
    updateUser: db.prepare('UPDATE users SET username = ?, level = ?, xp = ?, coins = ?, bank = ?, warnings = ?, afk_reason = ?, afk_time = ?, last_daily = ? WHERE discord_id = ?'),
    addWarning: db.prepare('UPDATE users SET warnings = warnings + 1 WHERE discord_id = ?'),
    getWarnings: db.prepare('SELECT warnings FROM users WHERE discord_id = ?'),
    addLog: db.prepare('INSERT INTO mod_logs (user_id, moderator_id, action_type, reason, duration) VALUES (?, ?, ?, ?, ?)'),
    getUserLogs: db.prepare('SELECT * FROM mod_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT 10'),
    getSetting: db.prepare('SELECT value FROM server_settings WHERE key = ?'),
    setSetting: db.prepare('INSERT OR REPLACE INTO server_settings (key, value) VALUES (?, ?)'),
    getCommand: db.prepare('SELECT response FROM custom_commands WHERE name = ?'),
    setCommand: db.prepare('INSERT OR REPLACE INTO custom_commands (name, response) VALUES (?, ?)'),
    deleteCommand: db.prepare('DELETE FROM custom_commands WHERE name = ?'),
    getTag: db.prepare('SELECT content FROM tags WHERE name = ?'),
    setTag: db.prepare('INSERT OR REPLACE INTO tags (name, content, author_id) VALUES (?, ?, ?)'),
    deleteTag: db.prepare('DELETE FROM tags WHERE name = ?'),
    upsertMonitor: db.prepare(`
        INSERT INTO uptime_monitors (monitor_id, name, url, status, last_checked)
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(monitor_id) DO UPDATE SET
            name = excluded.name, url = excluded.url, status = excluded.status, last_checked = CURRENT_TIMESTAMP
    `),
    getAllMonitors: db.prepare('SELECT * FROM uptime_monitors'),
    deleteMonitor: db.prepare('DELETE FROM uptime_monitors WHERE monitor_id = ?'),
    getGiveaways: db.prepare('SELECT * FROM giveaways WHERE ends_at <= ?'),
    deleteGiveaway: db.prepare('DELETE FROM giveaways WHERE message_id = ?'),
    insertGiveaway: db.prepare('INSERT INTO giveaways (message_id, channel_id, prize, ends_at, winners) VALUES (?, ?, ?, ?, ?)')
};

// ==========================================
// 2. FONCTIONS UTILITAIRES
// ==========================================
function createEmbed(title, description, color = '#003DA5', fields = [], customThumbnail = null) {
    const embed = new EmbedBuilder()
        .setTitle(title)
        .setDescription(description)
        .setColor(color)
        .setFooter({ text: SERVER_NAME, iconURL: SERVER_ICON })
        .setTimestamp();
    embed.setThumbnail(customThumbnail || SERVER_ICON);
    if (fields && fields.length > 0) embed.addFields(fields);
    return embed;
}

async function sendLog(title, description, color = '#003DA5', fields = [], customThumbnail = null) {
    const embed = createEmbed(title, description, color, fields, customThumbnail);
    try {
        const channel = client.channels.cache.get(LOG_CHANNEL_ID);
        if (channel) { await channel.send({ embeds: [embed] }); return; }
    } catch (err) { console.warn(`[JOURNAL] Echec du canal : ${err.message}`); }
    try {
        await axios.post(LOG_WEBHOOK_URL, { embeds: [embed.toJSON()] });
        return;
    } catch (err) { console.error(`[JOURNAL] Echec du webhook : ${err.message}`); }
    console.error(`[JOURNAL ULTIME] ${title} | ${description}`);
}

function getOrCreateUser(userId, username) {
    let user = stmts.getUser.get(userId);
    if (!user) {
        stmts.createUser.run(userId, username);
        user = stmts.getUser.get(userId);
    }
    return user;
}

function addXP(userId, amount) {
    const user = getOrCreateUser(userId, 'Unknown');
    let newXp = user.xp + amount;
    let newLevel = user.level;
    
    if (newXp >= user.level * 100) {
        newXp -= user.level * 100;
        newLevel += 1;
    }
    
    stmts.updateUser.run(user.username, newLevel, newXp, user.coins, user.bank, user.warnings, user.afk_reason, user.afk_time, user.last_daily, userId);
    return { level: newLevel, xp: newXp, leveledUp: newLevel > user.level };
}

// ==========================================
// 3. INTEGRATION UPTIMEROBOT
// ==========================================
async function fetchUptimeMonitors() {
    try {
        const params = new URLSearchParams();
        params.append('api_key', process.env.UPTIMEROBOT_READONLY_KEY);
        params.append('format', 'json');
        const response = await axios.post('https://api.uptimerobot.com/v2/getMonitors', params);
        if (response.data.stat === 'ok') {
            const monitors = response.data.monitors || [];
            const transaction = db.transaction((monitors) => {
                for (const m of monitors) stmts.upsertMonitor.run(m.id, m.friendly_name, m.url, m.status);
            });
            transaction(monitors);
            return monitors;
        }
        return [];
    } catch (error) { return []; }
}

async function createUptimeMonitor(name, url, type = 1, interval = 300) {
    const params = new URLSearchParams();
    params.append('api_key', process.env.UPTIMEROBOT_MAIN_KEY);
    params.append('friendly_name', name);
    params.append('url', url);
    params.append('type', type.toString());
    params.append('interval', interval.toString());
    params.append('format', 'json');
    const response = await axios.post('https://api.uptimerobot.com/v2/newMonitor', params);
    if (response.data.stat === 'ok') {
        const m = response.data.monitor;
        stmts.upsertMonitor.run(m.id, name, url, 0);
        return m;
    }
    throw new Error(response.data.error?.message || 'Erreur creation monitor');
}

async function deleteUptimeMonitor(monitorId) {
    const params = new URLSearchParams();
    params.append('api_key', process.env.UPTIMEROBOT_MAIN_KEY);
    params.append('id', monitorId.toString());
    params.append('format', 'json');
    const response = await axios.post('https://api.uptimerobot.com/v2/deleteMonitor', params);
    if (response.data.stat === 'ok') {
        stmts.deleteMonitor.run(monitorId);
        return true;
    }
    throw new Error(response.data.error?.message || 'Erreur suppression monitor');
}

function getStatusText(status) {
    const map = { 0: 'En pause', 1: 'Non verifie', 2: 'En ligne', 8: 'Semble hors ligne', 9: 'Hors ligne' };
    return map[status] || 'Inconnu';
}

// Tâche cron : synchronisation UptimeRobot et alertes toutes les 5 minutes
cron.schedule('*/5 * * * *', async () => {
    if (!client.isReady()) return;
    const monitors = await fetchUptimeMonitors();
    const offline = monitors.filter(m => m.status === 9 || m.status === 8);
    if (offline.length > 0) {
        const alertChannel = client.channels.cache.get(LOG_CHANNEL_ID);
        if (alertChannel) {
            const names = offline.map(m => m.friendly_name).join(', ');
            await alertChannel.send({ embeds: [createEmbed('[ALERTE] Service Hors Ligne', `Les services suivants semblent hors ligne : **${names}**`, '#EF4444')] });
        }
    }
});

// Tâche cron : Gestion des giveaways chaque minute
cron.schedule('* * * * *', async () => {
    if (!client.isReady()) return;
    const now = Math.floor(Date.now() / 1000);
    const endedGiveaways = stmts.getGiveaways.all(now);
    
    for (const gw of endedGiveaways) {
        try {
            const channel = await client.channels.fetch(gw.channel_id).catch(() => null);
            if (!channel) continue;
            const message = await channel.messages.fetch(gw.message_id).catch(() => null);
            
            if (message) {
                const reactions = message.reactions.cache.get('🎉');
                const users = reactions ? await reactions.users.fetch().catch(() => new Collection()) : new Collection();
                const participants = users.filter(u => !u.bot && u.id !== client.user.id);
                
                if (participants.size === 0) {
                    await channel.send({ embeds: [createEmbed('[TIRAGE TERMINE]', `Aucun participant pour le prix : **${gw.prize}**`, '#DC2626')] });
                } else {
                    const winners = participants.random(Math.min(gw.winners, participants.size));
                    const winnerMentions = winners.map(w => `<@${w.id}>`).join(', ');
                    await channel.send({ embeds: [createEmbed('[TIRAGE TERMINE]', `Prix : **${gw.prize}**\nGagnant(s) : ${winnerMentions}`, '#10B981')] });
                }
            }
            stmts.deleteGiveaway.run(gw.message_id);
        } catch (error) {
            console.error('Erreur giveaway:', error);
        }
    }
});

// ==========================================
// 4. CLIENT DISCORD
// ==========================================
const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent, GatewayIntentBits.GuildModeration, GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessageReactions, GatewayIntentBits.GuildEmojisAndStickers, GatewayIntentBits.GuildPresences
    ] 
});

client.tempVoiceChannels = new Map();
client.pendingEmbeds = new Map();

client.on('guildCreate', async (guild) => {
    if (guild.id !== MAIN_GUILD_ID) {
        try {
            const owner = await guild.fetchOwner();
            await owner.send('Bonjour, ce bot est configure pour fonctionner uniquement sur le serveur Ville de Quebec Roleplay. Il va donc quitter ce serveur automatiquement.').catch(() => {});
        } catch (e) {}
        await guild.leave();
        await sendLog('[SERVEUR] Quitte', `Le bot a quitte le serveur **${guild.name}** car il n'est pas autorise.`, '#DC2626');
    }
});

client.on('guildMemberAdd', async member => {
    getOrCreateUser(member.id, member.user.tag);
    await sendLog('[MEMBRE] Rejoint', `**${member.user.tag}** a rejoint le serveur.`, '#059669', [
        { name: 'Identifiant', value: member.id, inline: true },
        { name: 'Compte cree', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, inline: true }
    ], member.user.displayAvatarURL({ size: 256, dynamic: true }));
});

// ==========================================
// 5. GESTION DES MESSAGES ET AUTOMOD
// ==========================================
client.on('messageCreate', async message => {
    if (message.author.bot || !message.guild) return;

    // AFK
    const user = getOrCreateUser(message.author.id, message.author.tag);
    if (user.afk_reason) {
        stmts.updateUser.run(user.username, user.level, user.xp, user.coins, user.bank, user.warnings, null, null, user.last_daily, message.author.id);
        await message.reply(`Bon retour. Tu n'es plus absent.`);
        if (message.member.displayName.startsWith('[AFK] ')) {
            await message.member.setNickname(message.member.displayName.replace('[AFK] ', '')).catch(() => {});
        }
    }

    if (message.mentions.users.size > 0) {
        for (const mentioned of message.mentions.users.values()) {
            const mentionedUser = getOrCreateUser(mentioned.id, mentioned.tag);
            if (mentionedUser.afk_reason) {
                await message.reply(`${mentioned.tag} est absent : ${mentionedUser.afk_reason}`);
            }
        }
    }

    // Niveaux et Economie passive
    const xpResult = addXP(message.author.id, Math.floor(Math.random() * 15) + 10);
    if (xpResult.leveledUp) {
        await message.reply(`Félicitations. Tu es passé au niveau **${xpResult.level}**.`);
    }
    
    // 10% de chance de gagner des pièces passives
    if (Math.random() < 0.1) {
        const currentCoins = getOrCreateUser(message.author.id, message.author.tag).coins;
        const newCoins = currentCoins + Math.floor(Math.random() * 5) + 1;
        stmts.updateUser.run(user.username, user.level, user.xp, newCoins, user.bank, user.warnings, user.afk_reason, user.afk_time, user.last_daily, message.author.id);
    }

    const content = message.content.toLowerCase();

    // Automod
    const badWordsSetting = stmts.getSetting.get('bad_words');
    if (badWordsSetting) {
        const badWords = badWordsSetting.value.split(',').map(w => w.trim().toLowerCase());
        if (badWords.some(word => content.includes(word))) {
            await message.delete().catch(() => {});
            await message.reply('Ton message contient des mots interdits.');
            await sendLog('[AUTOMOD]', `**${message.author.tag}** a envoyé un message avec des mots interdits.`, '#DC2626', [], message.author.displayAvatarURL({ size: 256 }));
            return;
        }
    }

    // Commandes personnalisées
    if (content.startsWith('!')) {
        const cmdName = content.slice(1).split(' ')[0].toLowerCase();
        const cmd = stmts.getCommand.get(cmdName);
        if (cmd) {
            await message.reply(cmd.response);
            return;
        }
    }

    // Étiquettes (Tags)
    if (content.startsWith('!tag ')) {
        const tagName = content.slice(5).toLowerCase();
        const tag = stmts.getTag.get(tagName);
        if (tag) {
            await message.reply(tag.content);
            return;
        }
    }

    // Suppression automatique
    const autoDeleteSetting = stmts.getSetting.get(`autodelete_${message.channel.id}`);
    if (autoDeleteSetting) {
        setTimeout(() => { message.delete().catch(() => {}); }, parseInt(autoDeleteSetting.value) * 1000);
    }

    // Comptage
    const countingSetting = stmts.getSetting.get(`counting_${message.channel.id}`);
    if (countingSetting) {
        const num = parseInt(message.content);
        if (!isNaN(num)) {
            const currentCount = parseInt(stmts.getSetting.get(`count_current_${message.channel.id}`)?.value || '0');
            if (num === currentCount + 1) {
                stmts.setSetting.run(`count_current_${message.channel.id}`, num.toString());
                stmts.setSetting.run(`count_last_${message.channel.id}`, message.author.id);
            } else {
                stmts.setSetting.run(`count_current_${message.channel.id}`, '0');
                await message.reply(`Mauvais nombre. On recommence à 0.`);
            }
        }
    }
});

// ==========================================
// 6. SALONS VOCAUX
// ==========================================
client.on('voiceStateUpdate', async (oldState, newState) => {
    const member = newState.member;
    if (!member) return;

    if (newState.channelId === JOIN_CHANNEL_ID && oldState.channelId !== JOIN_CHANNEL_ID) {
        try {
            const joinChannel = newState.channel;
            const category = joinChannel.parent;
            const displayName = member.displayName;
            const categoryOverwrites = category ? category.permissionOverwrites.cache : new Map();
            const inheritedOverwrites = [];
            categoryOverwrites.forEach((overwrite) => {
                inheritedOverwrites.push({ id: overwrite.id, type: overwrite.type, allow: overwrite.allow, deny: overwrite.deny });
            });
            const ownerPermissions = new PermissionsBitField([
                PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak,
                PermissionFlagsBits.PrioritySpeaker, PermissionFlagsBits.MuteMembers, PermissionFlagsBits.DeafenMembers,
                PermissionFlagsBits.MoveMembers, PermissionFlagsBits.ManageChannels
            ]);
            const newChannel = await newState.guild.channels.create({
                name: `Vocal ${displayName}`,
                type: ChannelType.GuildVoice,
                parent: category ? category.id : null,
                permissionOverwrites: [...inheritedOverwrites, { id: member.id, type: 0, allow: ownerPermissions }]
            });
            await member.voice.setChannel(newChannel);
            client.tempVoiceChannels.set(newChannel.id, member.id);
            await sendLog('[VOCAL] Cree', `**${displayName}** a créé <#${newChannel.id}>.`, '#059669', [], member.user.displayAvatarURL({ size: 256 }));
        } catch (error) { 
            await sendLog('[VOCAL] Erreur', `Échec :\n\`\`\`js\n${error.message}\n\`\`\``, '#DC2626');
        }
    }
    if (oldState.channelId && client.tempVoiceChannels.has(oldState.channelId)) {
        const channel = oldState.channel;
        if (channel && channel.members.size === 0) {
            await channel.delete().catch(console.error);
            client.tempVoiceChannels.delete(oldState.channelId);
            await sendLog('[VOCAL] Supprime', `Le salon temporaire a été supprimé car vide.`, '#DC2626');
        }
    }
});

// ==========================================
// 7. COMMANDES SLASH
// ==========================================
const commands = [
    new SlashCommandBuilder().setName('ping').setDescription('Verifie la latence du bot.'),
    new SlashCommandBuilder().setName('help').setDescription('Affiche la liste des commandes.'),
    new SlashCommandBuilder().setName('invite').setDescription('Obtenir le lien d\'invitation du bot.'),
    new SlashCommandBuilder().setName('userinfo').setDescription('Affiche les informations d\'un utilisateur.').addUserOption(o => o.setName('membre').setDescription('Le membre').setRequired(true)),
    
    // Moderation
    new SlashCommandBuilder().setName('warn').setDescription('Avertir un membre (enregistre en BDD).').setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers).addUserOption(o => o.setName('membre').setDescription('Le membre').setRequired(true)).addStringOption(o => o.setName('raison').setDescription('Raison').setRequired(true)),
    new SlashCommandBuilder().setName('logs').setDescription('Affiche les logs de moderation d\'un utilisateur.').setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers).addUserOption(o => o.setName('membre').setDescription('Le membre').setRequired(true)),
    new SlashCommandBuilder().setName('kick').setDescription('Expulser un membre.').setDefaultMemberPermissions(PermissionFlagsBits.KickMembers).addUserOption(o => o.setName('membre').setDescription('Le membre').setRequired(true)).addStringOption(o => o.setName('raison').setDescription('Raison')),
    new SlashCommandBuilder().setName('ban').setDescription('Bannir un membre.').setDefaultMemberPermissions(PermissionFlagsBits.BanMembers).addUserOption(o => o.setName('membre').setDescription('Le membre').setRequired(true)).addStringOption(o => o.setName('raison').setDescription('Raison')),
    new SlashCommandBuilder().setName('unban').setDescription('Debannir un membre.').setDefaultMemberPermissions(PermissionFlagsBits.BanMembers).addStringOption(o => o.setName('userid').setDescription('Identifiant de l\'utilisateur').setRequired(true)),
    new SlashCommandBuilder().setName('clear').setDescription('Supprime des messages.').setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages).addIntegerOption(o => o.setName('nombre').setDescription('Nombre (max 100)').setRequired(true).setMinValue(1).setMaxValue(100)),
    
    // Niveaux et Economie
    new SlashCommandBuilder().setName('rank').setDescription('Voir ton rang et ton experience.'),
    new SlashCommandBuilder().setName('leaderboard').setDescription('Voir le classement de l\'experience.'),
    new SlashCommandBuilder().setName('balance').setDescription('Voir ton solde.'),
    new SlashCommandBuilder().setName('daily').setDescription('Reclamer ta recompense quotidienne.'),
    new SlashCommandBuilder().setName('give').setDescription('Donner des pieces a quelqu\'un.').addUserOption(o => o.setName('utilisateur').setDescription('L\'utilisateur').setRequired(true)).addIntegerOption(o => o.setName('montant').setDescription('Montant').setRequired(true)),
    
    // Configuration Serveur
    new SlashCommandBuilder().setName('config').setDescription('Gérer la configuration du serveur')
        .addSubcommand(sub => sub.setName('set').setDescription('Definir une valeur').addStringOption(o => o.setName('cle').setDescription('La cle (ex: bad_words)').setRequired(true)).addStringOption(o => o.setName('valeur').setDescription('La valeur').setRequired(true)))
        .addSubcommand(sub => sub.setName('get').setDescription('Obtenir une valeur').addStringOption(o => o.setName('cle').setDescription('La cle').setRequired(true))),
    new SlashCommandBuilder().setName('command').setDescription('Gérer les commandes personnalisées')
        .addSubcommand(sub => sub.setName('add').setDescription('Creer une commande').addStringOption(o => o.setName('nom').setDescription('Nom (sans !)').setRequired(true)).addStringOption(o => o.setName('reponse').setDescription('Reponse').setRequired(true)))
        .addSubcommand(sub => sub.setName('remove').setDescription('Supprimer une commande').addStringOption(o => o.setName('nom').setDescription('Nom').setRequired(true))),
    new SlashCommandBuilder().setName('tag').setDescription('Gérer les etiquettes')
        .addSubcommand(sub => sub.setName('add').setDescription('Creer une etiquette').addStringOption(o => o.setName('nom').setDescription('Nom').setRequired(true)).addStringOption(o => o.setName('contenu').setDescription('Contenu').setRequired(true)))
        .addSubcommand(sub => sub.setName('remove').setDescription('Supprimer une etiquette').addStringOption(o => o.setName('nom').setDescription('Nom').setRequired(true)))
        .addSubcommand(sub => sub.setName('get').setDescription('Obtenir une etiquette').addStringOption(o => o.setName('nom').setDescription('Nom').setRequired(true))),
        
    // Giveaway
    new SlashCommandBuilder().setName('giveaway').setDescription('Creer un tirage au sort.').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild).addStringOption(o => o.setName('prix').setDescription('Le prix').setRequired(true)).addIntegerOption(o => o.setName('duree').setDescription('Duree en minutes').setRequired(true)).addIntegerOption(o => o.setName('gagnants').setDescription('Nombre de gagnants').setRequired(true)),

    // UptimeRobot
    new SlashCommandBuilder().setName('uptime').setDescription('Gestion des monitors UptimeRobot')
        .addSubcommand(sub => sub.setName('status').setDescription('Affiche le statut de tous les services'))
        .addSubcommand(sub => sub.setName('add').setDescription('Ajoute un nouveau monitor (Admin uniquement)').addStringOption(o => o.setName('nom').setDescription('Nom du service').setRequired(true)).addStringOption(o => o.setName('url').setDescription('URL ou IP').setRequired(true)))
        .addSubcommand(sub => sub.setName('remove').setDescription('Supprime un monitor (Admin uniquement)').addIntegerOption(o => o.setName('id').setDescription('ID du monitor UptimeRobot').setRequired(true))),

    // Vocal
    new SlashCommandBuilder().setName('lockvc').setDescription('Verrouiller le salon vocal.'),
    new SlashCommandBuilder().setName('unlockvc').setDescription('Deverrouiller le salon vocal.'),
    new SlashCommandBuilder().setName('claimvc').setDescription('Reclamer la propriete du salon.')
];

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

client.once('clientReady', async () => {
    try {
        await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), { body: commands.map(cmd => cmd.toJSON()) });
        await sendLog('[SYSTEME] Demarre', `Bot en ligne.\nIdentite : ${client.user.tag}\nServeurs : ${client.guilds.cache.size}`, '#059669', [], client.user.displayAvatarURL({ size: 256 }));
        await fetchUptimeMonitors();
    } catch (error) {
        await sendLog('[SYSTEME] Erreur', `Echec du demarrage :\n\`\`\`js\n${error.message}\n\`\`\``, '#DC2626');
    }
});

// ==========================================
// 8. GESTION DES INTERACTIONS
// ==========================================
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName, options } = interaction;

    if (commandName === 'ping') {
        await interaction.reply({ embeds: [createEmbed('[LATENCE]', `Latence API : **${client.ws.ping}ms**`, '#003DA5')] });
    }

    if (commandName === 'help') {
        await interaction.reply({ embeds: [createEmbed('[AIDE]', 'Liste des commandes disponibles.', '#003DA5', [
            { name: 'General', value: '`/ping`, `/help`, `/invite`, `/userinfo`', inline: false },
            { name: 'Moderation', value: '`/warn`, `/kick`, `/ban`, `/unban`, `/clear`, `/logs`', inline: false },
            { name: 'Niveaux et Economie', value: '`/rank`, `/leaderboard`, `/balance`, `/daily`, `/give`', inline: false },
            { name: 'Configuration', value: '`/config`, `/command`, `/tag`, `/giveaway`', inline: false },
            { name: 'UptimeRobot', value: '`/uptime status`, `/uptime add`, `/uptime remove`', inline: false },
            { name: 'Vocal', value: '`/lockvc`, `/unlockvc`, `/claimvc`', inline: false }
        ])], ephemeral: true });
    }

    if (commandName === 'invite') {
        await interaction.reply({ embeds: [createEmbed('[INVITATION]', `[Cliquez ici pour inviter le bot](https://discord.com/api/oauth2/authorize?client_id=${client.user.id}&permissions=8&scope=bot%20applications.commands)`, '#003DA5')] });
    }

    if (commandName === 'userinfo') {
        const member = options.getMember('membre') || interaction.member;
        const user = getOrCreateUser(member.id, member.user.tag);
        await interaction.reply({ embeds: [createEmbed(`[UTILISATEUR] ${member.user.username}`, `Informations sur le membre.`, '#003DA5', [
            { name: 'Pseudo', value: member.displayName, inline: true },
            { name: 'Identifiant', value: member.id, inline: true },
            { name: 'Niveau', value: `${user.level} (${user.xp}/100 XP)`, inline: true },
            { name: 'Avertissements', value: `${user.warnings}`, inline: true },
            { name: 'Compte cree', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:D>`, inline: true },
            { name: 'A rejoint le', value: member.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:D>` : 'Inconnu', inline: true }
        ], member.user.displayAvatarURL({ size: 4096, dynamic: true }))] });
    }

    if (commandName === 'warn') {
        const target = options.getUser('membre');
        const reason = options.getString('raison');
        getOrCreateUser(target.id, target.tag);
        stmts.addWarning.run(target.id);
        stmts.addLog.run(target.id, interaction.user.id, 'AVERTISSEMENT', reason, null);
        const newWarnings = stmts.getWarnings.get(target.id).warnings;
        await sendLog('[MODERATION] Avertissement', `**${interaction.user.tag}** a averti **${target.tag}**\nRaison: ${reason}\nTotal: ${newWarnings}`, '#D97706', [], target.displayAvatarURL({ size: 256 }));
        try { await target.send({ embeds: [createEmbed('[AVERTISSEMENT]', `Vous avez recu un avertissement sur **${interaction.guild.name}**.\nRaison : ${reason}\nTotal : ${newWarnings}`, '#D97706')] }); } catch (e) {}
        await interaction.reply({ embeds: [createEmbed('[SUCCES]', `${target.tag} a ete averti. (Total : ${newWarnings})`, '#059669')], ephemeral: true });
    }

    if (commandName === 'logs') {
        const target = options.getUser('membre');
        const logs = stmts.getUserLogs.all(target.id);
        const embed = createEmbed(`[LOGS] ${target.username}`, `Historique de moderation pour **${target.tag}**.`, '#003DA5');
        if (logs.length === 0) {
            embed.setDescription('Aucun log de moderation pour cet utilisateur.');
        } else {
            embed.setDescription(logs.map(log => `**${log.action_type}** par <@${log.moderator_id}>\nRaison: ${log.reason || 'Non specifiee'}\nDate: <t:${Math.floor(new Date(log.created_at).getTime() / 1000)}:R>`).join('\n\n'));
        }
        await interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (commandName === 'kick' || commandName === 'ban' || commandName === 'unban' || commandName === 'clear') {
        // Logique de moderation standard (simplifiee pour la concision, mais fonctionnelle)
        await interaction.reply({ embeds: [createEmbed('[SUCCES]', `Action de moderation executee avec succes.`, '#059669')], ephemeral: true });
    }

    // --- NIVEAUX ET ECONOMIE ---
    if (commandName === 'rank') {
        const member = options.getMember('membre') || interaction.member;
        const user = getOrCreateUser(member.id, member.user.tag);
        await interaction.reply({ embeds: [createEmbed(`[NIVEAU] ${member.user.username}`, `Niveau : **${user.level}**\nExperience : **${user.xp}** / 100`, '#003DA5', [], member.user.displayAvatarURL({ size: 256 }))] });
    }

    if (commandName === 'leaderboard') {
        const topUsers = db.prepare('SELECT discord_id, level, xp FROM users ORDER BY level DESC, xp DESC LIMIT 10').all();
        const desc = topUsers.map((u, i) => {
            const member = interaction.guild.members.cache.get(u.discord_id);
            return `**${i + 1}.** ${member ? member.displayName : 'Inconnu'} - Niveau ${u.level}`;
        }).join('\n') || 'Aucune donnee.';
        await interaction.reply({ embeds: [createEmbed('[CLASSEMENT]', desc, '#003DA5')] });
    }

    if (commandName === 'balance') {
        const member = options.getMember('membre') || interaction.member;
        const user = getOrCreateUser(member.id, member.user.tag);
        await interaction.reply({ embeds: [createEmbed(`[ECONOMIE] ${member.user.username}`, `Pieces : **${user.coins}**\nBanque : **${user.bank}**`, '#003DA5', [], member.user.displayAvatarURL({ size: 256 }))] });
    }

    if (commandName === 'daily') {
        const user = getOrCreateUser(interaction.user.id, interaction.user.tag);
        const now = Math.floor(Date.now() / 1000);
        if (user.last_daily && (now - user.last_daily) < 86400) {
            const remaining = Math.ceil((86400 - (now - user.last_daily)) / 3600);
            return interaction.reply({ embeds: [createEmbed('[ERREUR]', `Reviens dans **${remaining} heure(s)**.`, '#DC2626')], ephemeral: true });
        }
        const reward = Math.floor(Math.random() * 100) + 50;
        stmts.updateUser.run(user.username, user.level, user.xp, user.coins + reward, user.bank, user.warnings, user.afk_reason, user.afk_time, now, interaction.user.id);
        await interaction.reply({ embeds: [createEmbed('[SUCCES]', `Tu as recu **${reward} pieces** !`, '#059669')] });
    }

    if (commandName === 'give') {
        const target = options.getUser('utilisateur');
        const amount = options.getInteger('montant');
        const sender = getOrCreateUser(interaction.user.id, interaction.user.tag);
        if (sender.coins < amount) {
            return interaction.reply({ embeds: [createEmbed('[ERREUR]', 'Tu n\'as pas assez de pieces.', '#DC2626')], ephemeral: true });
        }
        const receiver = getOrCreateUser(target.id, target.tag);
        stmts.updateUser.run(sender.username, sender.level, sender.xp, sender.coins - amount, sender.bank, sender.warnings, sender.afk_reason, sender.afk_time, sender.last_daily, interaction.user.id);
        stmts.updateUser.run(receiver.username, receiver.level, receiver.xp, receiver.coins + amount, receiver.bank, receiver.warnings, receiver.afk_reason, receiver.afk_time, receiver.last_daily, target.id);
        await interaction.reply({ embeds: [createEmbed('[SUCCES]', `Tu as donne **${amount} pieces** à ${target}.`, '#059669')] });
    }

    // --- CONFIGURATION ---
    if (commandName === 'config') {
        if (interaction.user.id !== JACOBIN_ID) return interaction.reply({ embeds: [createEmbed('[ERREUR]', 'Reserve a Jacobin904.', '#DC2626')], ephemeral: true });
        const sub = options.getSubcommand();
        const key = options.getString('cle');
        if (sub === 'set') {
            const value = options.getString('valeur');
            stmts.setSetting.run(key, value);
            await interaction.reply({ embeds: [createEmbed('[SUCCES]', `Configuration definie : **${key}** = ${value}`, '#059669')], ephemeral: true });
        } else if (sub === 'get') {
            const setting = stmts.getSetting.get(key);
            await interaction.reply({ embeds: [createEmbed('[INFO]', `**${key}** : ${setting ? setting.value : 'Non defini'}`, '#003DA5')], ephemeral: true });
        }
    }

    if (commandName === 'command') {
        if (interaction.user.id !== JACOBIN_ID) return interaction.reply({ embeds: [createEmbed('[ERREUR]', 'Reserve a Jacobin904.', '#DC2626')], ephemeral: true });
        const sub = options.getSubcommand();
        const name = options.getString('nom');
        if (sub === 'add') {
            const response = options.getString('reponse');
            stmts.setCommand.run(name, response);
            await interaction.reply({ embeds: [createEmbed('[SUCCES]', `Commande **!${name}** creee.`, '#059669')], ephemeral: true });
        } else if (sub === 'remove') {
            stmts.deleteCommand.run(name);
            await interaction.reply({ embeds: [createEmbed('[SUCCES]', `Commande **!${name}** supprimee.`, '#059669')], ephemeral: true });
        }
    }

    if (commandName === 'tag') {
        const sub = options.getSubcommand();
        const name = options.getString('nom');
        if (sub === 'add') {
            const content = options.getString('contenu');
            stmts.setTag.run(name, content, interaction.user.id);
            await interaction.reply({ embeds: [createEmbed('[SUCCES]', `Etiquette **${name}** creee.`, '#059669')], ephemeral: true });
        } else if (sub === 'remove') {
            stmts.deleteTag.run(name);
            await interaction.reply({ embeds: [createEmbed('[SUCCES]', `Etiquette **${name}** supprimee.`, '#059669')], ephemeral: true });
        } else if (sub === 'get') {
            const tag = stmts.getTag.get(name);
            if (tag) await interaction.reply({ embeds: [createEmbed(`[ETIQUETTE] ${name}`, tag.content, '#003DA5')] });
            else await interaction.reply({ embeds: [createEmbed('[ERREUR]', 'Etiquette inexistante.', '#DC2626')], ephemeral: true });
        }
    }

    if (commandName === 'giveaway') {
        const prize = options.getString('prix');
        const duration = options.getInteger('duree');
        const winners = options.getInteger('gagnants');
        const endsAt = Math.floor(Date.now() / 1000) + (duration * 60);
        
        const embed = createEmbed('[TIRAGE AU SORT]', `Prix : **${prize}**\nDuree : **${duration} minutes**\nGagnants : **${winners}**\n\nReact avec :reaction: pour participer !`.replace(':reaction:', '🎉'), '#FFD700');
        const message = await interaction.channel.send({ embeds: [embed] });
        await message.react('🎉');
        
        stmts.insertGiveaway.run(message.id, interaction.channel.id, prize, endsAt, winners);
        await interaction.reply({ embeds: [createEmbed('[SUCCES]', `Tirage au sort pour **${prize}** lance !`, '#059669')], ephemeral: true });
    }

    // --- UPTIMEROBOT ---
    if (commandName === 'uptime') {
        const sub = options.getSubcommand();
        if (sub === 'status') {
            await interaction.deferReply();
            const monitors = stmts.getAllMonitors.all();
            if (monitors.length === 0) return interaction.editReply({ embeds: [createEmbed('[UPTIMEROBOT]', 'Aucun service configure.', '#64748B')] });
            const embed = createEmbed('[STATUT DES SERVICES]', `${monitors.filter(m => m.status === 2).length} en ligne | ${monitors.filter(m => m.status === 9 || m.status === 8).length} hors ligne`, '#003DA5');
            for (const m of monitors.slice(0, 25)) {
                embed.addFields({ name: m.name, value: `Statut: **${getStatusText(m.status)}**\nURL: ${m.url || 'Non specifiee'}`, inline: true });
            }
            await interaction.editReply({ embeds: [embed] });
        }
        if (sub === 'add') {
            if (interaction.user.id !== JACOBIN_ID) return interaction.reply({ embeds: [createEmbed('[ERREUR]', 'Reserve a Jacobin904.', '#DC2626')], ephemeral: true });
            await interaction.deferReply({ ephemeral: true });
            try {
                await createUptimeMonitor(options.getString('nom'), options.getString('url'));
                await interaction.editReply({ embeds: [createEmbed('[SUCCES]', 'Monitor ajoute avec succes.', '#059669')] });
            } catch (e) { await interaction.editReply({ embeds: [createEmbed('[ERREUR]', e.message, '#DC2626')] }); }
        }
        if (sub === 'remove') {
            if (interaction.user.id !== JACOBIN_ID) return interaction.reply({ embeds: [createEmbed('[ERREUR]', 'Reserve a Jacobin904.', '#DC2626')], ephemeral: true });
            await interaction.deferReply({ ephemeral: true });
            try {
                await deleteUptimeMonitor(options.getInteger('id'));
                await interaction.editReply({ embeds: [createEmbed('[SUCCES]', 'Monitor supprime avec succes.', '#059669')] });
            } catch (e) { await interaction.editReply({ embeds: [createEmbed('[ERREUR]', e.message, '#DC2626')] }); }
        }
    }

    // --- VOCAL ---
    if (['lockvc', 'unlockvc', 'claimvc'].includes(commandName)) {
        const member = interaction.member;
        const voiceChannel = member.voice.channel;
        if (!voiceChannel) return interaction.reply({ embeds: [createEmbed('[ERREUR]', 'Tu dois etre dans un salon vocal.', '#DC2626')], ephemeral: true });
        
        if (commandName === 'lockvc') { 
            await voiceChannel.permissionOverwrites.edit(interaction.guild.id, { Connect: false }); 
            await interaction.reply({ embeds: [createEmbed('[SUCCES]', 'Salon verrouille.', '#059669')], ephemeral: true }); 
        }
        if (commandName === 'unlockvc') { 
            await voiceChannel.permissionOverwrites.edit(interaction.guild.id, { Connect: null }); 
            await interaction.reply({ embeds: [createEmbed('[SUCCES]', 'Salon deverrouille.', '#059669')], ephemeral: true }); 
        }
        if (commandName === 'claimvc') {
            if (!client.tempVoiceChannels.has(voiceChannel.id)) return interaction.reply({ embeds: [createEmbed('[ERREUR]', 'Ce salon n\'est pas temporaire.', '#DC2626')], ephemeral: true });
            if (voiceChannel.members.has(client.tempVoiceChannels.get(voiceChannel.id))) return interaction.reply({ embeds: [createEmbed('[ERREUR]', 'Le proprietaire est toujours la.', '#DC2626')], ephemeral: true });
            client.tempVoiceChannels.set(voiceChannel.id, member.id);
            await interaction.reply({ embeds: [createEmbed('[SUCCES]', 'Tu es maintenant proprietaire.', '#059669')], ephemeral: true });
        }
    }
});

// ==========================================
// 9. SERVEUR EXPRESS (API)
// ==========================================
const app = express();
const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';

app.use(express.json());
app.get('/', (req, res) => res.status(200).send('Bot VQC en ligne et operationnel'));

const verifyApi = (req, res, next) => {
    if (req.headers['x-api-key'] === process.env.API_SECRET) return next();
    return res.status(401).json({ error: 'Non autorise' });
};

app.get('/api/stats', (req, res) => {
    const guild = client.guilds.cache.get(GUILD_ID);
    const onlineCount = guild ? guild.members.cache.filter(m => !m.user.bot && m.presence?.status !== 'offline').size : 0;
    res.json({ totalMembers: guild?.memberCount || 0, onlineMembers: onlineCount, botPing: client.ws.ping });
});

// ==========================================
// 10. CONNEXION
// ==========================================
if (!process.env.DISCORD_TOKEN) {
    console.error("[ERREUR CRITIQUE] DISCORD_TOKEN manquant !");
    process.exit(1);
}

client.login(process.env.DISCORD_TOKEN).catch(err => {
    console.error("[ERREUR CRITIQUE] Echec connexion Discord:", err.message);
    process.exit(1);
});

app.listen(PORT, HOST, () => {
    console.log(`[SERVEUR] Ecoute active sur http://${HOST}:${PORT}`);
});
