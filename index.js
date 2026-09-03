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

// Initialisation de la base de donnees SQLite locale
const dbPath = path.join(__dirname, 'vqc_database.sqlite');
const sqlite = new Database(dbPath);

// Creation des tables si elles n'existent pas
sqlite.exec(`
    CREATE TABLE IF NOT EXISTS users (
        discord_id TEXT PRIMARY KEY,
        username TEXT,
        warnings INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS mod_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT,
        moderator_id TEXT,
        action_type TEXT,
        reason TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS uptime_monitors (
        monitor_id INTEGER PRIMARY KEY,
        name TEXT,
        url TEXT,
        status INTEGER,
        last_checked TEXT
    );
`);

// Requêtes preparees pour la performance
const stmts = {
    getUser: sqlite.prepare('SELECT * FROM users WHERE discord_id = ?'),
    createUser: sqlite.prepare('INSERT OR IGNORE INTO users (discord_id, username) VALUES (?, ?)'),
    addWarning: sqlite.prepare('UPDATE users SET warnings = warnings + 1 WHERE discord_id = ?'),
    getWarnings: sqlite.prepare('SELECT warnings FROM users WHERE discord_id = ?'),
    addLog: sqlite.prepare('INSERT INTO mod_logs (user_id, moderator_id, action_type, reason) VALUES (?, ?, ?, ?)'),
    getUserLogs: sqlite.prepare('SELECT * FROM mod_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT 10'),
    upsertMonitor: sqlite.prepare(`
        INSERT INTO uptime_monitors (monitor_id, name, url, status, last_checked)
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(monitor_id) DO UPDATE SET
            name = excluded.name, url = excluded.url, status = excluded.status, last_checked = CURRENT_TIMESTAMP
    `),
    getAllMonitors: sqlite.prepare('SELECT * FROM uptime_monitors'),
    deleteMonitor: sqlite.prepare('DELETE FROM uptime_monitors WHERE monitor_id = ?')
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
            const transaction = sqlite.transaction((monitors) => {
                for (const m of monitors) {
                    stmts.upsertMonitor.run(m.id, m.friendly_name, m.url, m.status);
                }
            });
            transaction(monitors);
            return monitors;
        }
        return [];
    } catch (error) {
        console.error('Erreur UptimeRobot:', error.message);
        return [];
    }
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

function getStatusColor(status) {
    const map = { 0: '#64748B', 1: '#94A3B8', 2: '#10B981', 8: '#F59E0B', 9: '#EF4444' };
    return map[status] || '#64748B';
}

// Synchronisation automatique toutes les 5 minutes
setInterval(async () => {
    if (client.isReady()) {
        const monitors = await fetchUptimeMonitors();
        const offline = monitors.filter(m => m.status === 9 || m.status === 8);
        if (offline.length > 0) {
            const alertChannel = client.channels.cache.get(LOG_CHANNEL_ID);
            if (alertChannel) {
                const names = offline.map(m => m.friendly_name).join(', ');
                await alertChannel.send({ 
                    embeds: [createEmbed('[ALERTE] Service Hors Ligne', `Les services suivants semblent hors ligne : **${names}**`, '#EF4444')] 
                });
            }
        }
    }
}, 300000);

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
    stmts.createUser.run(member.id, member.user.tag);
    await sendLog('[MEMBRE] Rejoint', `**${member.user.tag}** a rejoint le serveur.`, '#059669', [
        { name: 'Identifiant', value: member.id, inline: true },
        { name: 'Compte cree', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, inline: true }
    ], member.user.displayAvatarURL({ size: 256, dynamic: true }));
});

// ==========================================
// 5. COMMANDES SLASH
// ==========================================
const commands = [
    new SlashCommandBuilder().setName('ping').setDescription('Verifie la latence du bot.'),
    new SlashCommandBuilder().setName('help').setDescription('Affiche la liste des commandes.'),
    new SlashCommandBuilder().setName('invite').setDescription('Obtenir le lien d\'invitation du bot.'),
    new SlashCommandBuilder().setName('userinfo').setDescription('Affiche les informations d\'un utilisateur.').addUserOption(o => o.setName('membre').setDescription('Le membre').setRequired(true)),
    
    // Commandes Staff / Moderation
    new SlashCommandBuilder().setName('warn').setDescription('Avertir un membre (enregistre en BDD).').setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers).addUserOption(o => o.setName('membre').setDescription('Le membre').setRequired(true)).addStringOption(o => o.setName('raison').setDescription('Raison').setRequired(true)),
    new SlashCommandBuilder().setName('logs').setDescription('Affiche les logs de moderation d\'un utilisateur.').setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers).addUserOption(o => o.setName('membre').setDescription('Le membre').setRequired(true)),
    
    // Commandes UptimeRobot
    new SlashCommandBuilder().setName('uptime').setDescription('Gestion des monitors UptimeRobot')
        .addSubcommand(sub => sub.setName('status').setDescription('Affiche le statut de tous les services'))
        .addSubcommand(sub => sub.setName('add').setDescription('Ajoute un nouveau monitor (Admin uniquement)').addStringOption(o => o.setName('nom').setDescription('Nom du service').setRequired(true)).addStringOption(o => o.setName('url').setDescription('URL ou IP').setRequired(true)))
        .addSubcommand(sub => sub.setName('remove').setDescription('Supprime un monitor (Admin uniquement)').addIntegerOption(o => o.setName('id').setDescription('ID du monitor UptimeRobot').setRequired(true)))
];

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

client.once('clientReady', async () => {
    try {
        await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), { body: commands.map(cmd => cmd.toJSON()) });
        await sendLog('[SYSTEME] Demarre', `Bot en ligne.\nIdentite : ${client.user.tag}\nServeurs : ${client.guilds.cache.size}`, '#059669', [], client.user.displayAvatarURL({ size: 256 }));
        
        // Chargement initial des monitors
        await fetchUptimeMonitors();
    } catch (error) {
        await sendLog('[SYSTEME] Erreur', `Echec du demarrage :\n\`\`\`js\n${error.message}\n\`\`\``, '#DC2626');
    }
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName, options } = interaction;

    if (commandName === 'ping') {
        await interaction.reply({ embeds: [createEmbed('[LATENCE]', `Latence API : **${client.ws.ping}ms**`, '#003DA5')] });
    }

    if (commandName === 'help') {
        await interaction.reply({ embeds: [createEmbed('[AIDE]', 'Liste des commandes disponibles.', '#003DA5', [
            { name: 'General', value: '`/ping`, `/help`, `/invite`, `/userinfo`', inline: false },
            { name: 'Moderation', value: '`/warn`, `/logs`', inline: false },
            { name: 'UptimeRobot', value: '`/uptime status`, `/uptime add`, `/uptime remove`', inline: false }
        ])], ephemeral: true });
    }

    if (commandName === 'invite') {
        await interaction.reply({ embeds: [createEmbed('[INVITATION]', `[Cliquez ici pour inviter le bot](https://discord.com/api/oauth2/authorize?client_id=${client.user.id}&permissions=8&scope=bot%20applications.commands)`, '#003DA5')] });
    }

    if (commandName === 'userinfo') {
        const member = options.getMember('membre') || interaction.member;
        const userData = stmts.getUser.get(member.id);
        const warnings = userData ? userData.warnings : 0;
        
        await interaction.reply({ embeds: [createEmbed(`[UTILISATEUR] ${member.user.username}`, `Informations sur le membre.`, '#003DA5', [
            { name: 'Pseudo', value: member.displayName, inline: true },
            { name: 'Identifiant', value: member.id, inline: true },
            { name: 'Avertissements', value: `${warnings}`, inline: true },
            { name: 'Compte cree', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:D>`, inline: true },
            { name: 'A rejoint le', value: member.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:D>` : 'Inconnu', inline: true }
        ], member.user.displayAvatarURL({ size: 4096, dynamic: true }))] });
    }

    if (commandName === 'warn') {
        const target = options.getUser('membre');
        const reason = options.getString('raison');
        
        stmts.createUser.run(target.id, target.tag);
        stmts.addWarning.run(target.id);
        stmts.addLog.run(target.id, interaction.user.id, 'AVERTISSEMENT', reason);
        
        const newWarnings = stmts.getWarnings.get(target.id).warnings;
        
        await sendLog('[MODERATION] Avertissement', `**${interaction.user.tag}** a averti **${target.tag}**\nRaison: ${reason}\nTotal avertissements: ${newWarnings}`, '#D97706', [], target.displayAvatarURL({ size: 256 }));
        
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
            const logText = logs.map(log => {
                return `**${log.action_type}** par <@${log.moderator_id}>\nRaison: ${log.reason || 'Non specifiee'}\nDate: <t:${Math.floor(new Date(log.created_at).getTime() / 1000)}:R>`;
            }).join('\n\n');
            embed.setDescription(logText);
        }
        await interaction.reply({ embeds: [embed], ephemeral: true });
    }

    // --- COMMANDES UPTIMEROBOT ---
    if (commandName === 'uptime') {
        const subcommand = options.getSubcommand();
        
        if (subcommand === 'status') {
            await interaction.deferReply();
            const monitors = stmts.getAllMonitors.all();
            
            if (monitors.length === 0) {
                return interaction.editReply({ embeds: [createEmbed('[UPTIMEROBOT]', 'Aucun service configure dans la base de donnees.', '#64748B')] });
            }
            
            const online = monitors.filter(m => m.status === 2).length;
            const offline = monitors.filter(m => m.status === 9 || m.status === 8).length;
            
            const embed = createEmbed('[STATUT DES SERVICES]', `**${online}** en ligne | **${offline}** hors ligne`, offline > 0 ? '#EF4444' : '#10B981');
            
            for (const m of monitors.slice(0, 25)) {
                embed.addFields({
                    name: m.name,
                    value: `Statut: **${getStatusText(m.status)}**\nURL: ${m.url || 'Non specifiee'}`,
                    inline: true
                });
            }
            await interaction.editReply({ embeds: [embed] });
        }
        
        if (subcommand === 'add') {
            if (interaction.user.id !== JACOBIN_ID) {
                return interaction.reply({ embeds: [createEmbed('[ERREUR]', 'Cette commande est reservee a Jacobin904.', '#DC2626')], ephemeral: true });
            }
            await interaction.deferReply({ ephemeral: true });
            const name = options.getString('nom');
            const url = options.getString('url');
            
            try {
                await createUptimeMonitor(name, url);
                await fetchUptimeMonitors(); // Rafraichir le cache local
                await interaction.editReply({ embeds: [createEmbed('[SUCCES]', `Le monitor **${name}** a ete ajoute avec succes.`, '#059669')] });
            } catch (error) {
                await interaction.editReply({ embeds: [createEmbed('[ERREUR]', `Echec de l'ajout : ${error.message}`, '#DC2626')] });
            }
        }
        
        if (subcommand === 'remove') {
            if (interaction.user.id !== JACOBIN_ID) {
                return interaction.reply({ embeds: [createEmbed('[ERREUR]', 'Cette commande est reservee a Jacobin904.', '#DC2626')], ephemeral: true });
            }
            await interaction.deferReply({ ephemeral: true });
            const monitorId = options.getInteger('id');
            
            try {
                await deleteUptimeMonitor(monitorId);
                await interaction.editReply({ embeds: [createEmbed('[SUCCES]', `Le monitor **${monitorId}** a ete supprime avec succes.`, '#059669')] });
            } catch (error) {
                await interaction.editReply({ embeds: [createEmbed('[ERREUR]', `Echec de la suppression : ${error.message}`, '#DC2626')] });
            }
        }
    }
});

// ==========================================
// 6. SERVEUR EXPRESS (API)
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
// 7. CONNEXION
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
