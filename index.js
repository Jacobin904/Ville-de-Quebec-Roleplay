require('dotenv').config();
const fs = require('fs');
if (fs.existsSync('.env.production')) {
    require('dotenv').config({ path: '.env.production', override: true });
}

const express = require('express');
const axios = require('axios');
const { 
    Client, GatewayIntentBits, EmbedBuilder, SlashCommandBuilder, 
    REST, Routes, ChannelType, PermissionFlagsBits, 
    ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, 
    TextInputBuilder, TextInputStyle, PermissionsBitField,
    Collection
} = require('discord.js');

// ==========================================
// 1. CONFIGURATION & CONSTANTES
// ==========================================
const SERVER_ICON = 'https://cdn.discordapp.com/icons/1490410149213507804/0b1aa46a2fdb33b133a0feb1234739f6.webp?size=1024';
const SERVER_NAME = 'Ville de Québec Roleplay (VQC)';
const LOG_CHANNEL_ID = '1538659168012075029';
const LOG_WEBHOOK_URL = 'https://discord.com/api/webhooks/1538661235283857560/izzc3OJH6n6mVZPUo7JCxJUHdI6Q3y6CdWqvCsS4MP5AiPTNFpk7CFnufHZCVwV6WVXk';
const JOIN_CHANNEL_ID = '1537569455754969188';
const JACOBIN_ID = '1281784488854159421';
const GUILD_ID = process.env.GUILD_ID;

// Base de données en mémoire
const db = {
    levels: new Map(),
    afk: new Map(),
    reminders: new Map(),
    autoroles: new Map(),
    tags: new Map(),
    customCommands: new Map(),
    autoMessages: new Map(),
    reactionRoles: new Map(),
    starboard: new Map(),
    giveaways: new Map(),
    forms: new Map(),
    highlights: new Map(),
    economy: new Map(),
    autoDelete: new Map(),
    autoresponders: new Map(),
    automod: { badWords: [], maxMentions: 5, maxLinks: 3 },
    tempVoiceChannels: new Map(),
    pendingEmbeds: new Map(),
    voiceTextChannels: new Map(),
    slowmode: new Map(),
    welcome: { enabled: true, channel: null, message: 'Bienvenue {user} sur **{guild}** !' },
    leave: { enabled: true, channel: null, message: '{user} a quitté le serveur.' },
    modlogs: { enabled: true, channel: null },
    serverlogs: { enabled: true, channel: null },
    warnCount: new Map(),
    muteCount: new Map(),
    blacklist: new Set(),
    whitelist: new Set(),
    selfroles: new Map(),
    suggestions: { enabled: true, channel: null, approve: null, deny: null },
    counting: { enabled: false, channel: null, current: 0, lastUser: null },
    trivia: { enabled: false, channel: null, score: new Map() }
};

// ==========================================
// 2. FONCTIONS UTILITAIRES PROFESSIONNELLES
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
    } catch (err) { console.warn(`[LOG] Échec canal: ${err.message}`); }
    try {
        await axios.post(LOG_WEBHOOK_URL, { embeds: [embed.toJSON()] });
        return;
    } catch (err) { console.error(`[LOG] Échec Webhook: ${err.message}`); }
    console.error(`[LOG ULTIME] ${title} | ${description}`);
}

async function sendModLog(action, target, moderator, reason = 'Aucune', color = '#D97706') {
    if (!db.modlogs.enabled || !db.modlogs.channel) return;
    const channel = client.channels.cache.get(db.modlogs.channel);
    if (!channel) return;
    const embed = createEmbed(`🛡️ ${action}`, `**Cible :** ${target.tag}\n**Modérateur :** ${moderator.tag}\n**Raison :** ${reason}`, color, [], target.displayAvatarURL({ size: 256 }));
    await channel.send({ embeds: [embed] });
}

async function sendServerLog(event, description, color = '#4d8dff') {
    if (!db.serverlogs.enabled || !db.serverlogs.channel) return;
    const channel = client.channels.cache.get(db.serverlogs.channel);
    if (!channel) return;
    const embed = createEmbed(`📋 ${event}`, description, color);
    await channel.send({ embeds: [embed] });
}

function getXP(userId) {
    if (!db.levels.has(userId)) db.levels.set(userId, { xp: 0, level: 1 });
    return db.levels.get(userId);
}

function addXP(userId, amount) {
    const data = getXP(userId);
    data.xp += amount;
    const xpNeeded = data.level * 100;
    if (data.xp >= xpNeeded) {
        data.xp -= xpNeeded;
        data.level++;
        return data.level;
    }
    return null;
}

function getEconomy(userId) {
    if (!db.economy.has(userId)) db.economy.set(userId, { coins: 100, bank: 0 });
    return db.economy.get(userId);
}

function getWarnCount(userId) {
    if (!db.warnCount.has(userId)) db.warnCount.set(userId, 0);
    return db.warnCount.get(userId);
}

function addWarn(userId) {
    const count = getWarnCount(userId) + 1;
    db.warnCount.set(userId, count);
    return count;
}

// ==========================================
// 3. SERVEUR EXPRESS + API
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

app.get('/', (req, res) => res.status(200).send('Bot VQC en ligne et opérationnel'));

const verifyApi = (req, res, next) => {
    const key = req.headers['x-api-key'];
    if (key === process.env.API_SECRET) return next();
    return res.status(401).json({ error: 'Non autorisé' });
};

app.get('/api/stats', (req, res) => {
    const guild = client.guilds.cache.get(GUILD_ID);
    const onlineCount = guild ? guild.members.cache.filter(m => !m.user.bot && m.presence?.status !== 'offline').size : 0;
    res.json({ totalMembers: guild?.memberCount || 0, onlineMembers: onlineCount, botPing: client.ws.ping });
});

app.get('/api/staff', verifyApi, (req, res) => {
    const guild = client.guilds.cache.get(GUILD_ID);
    const staffRoles = ['1521217940035473429', '1533823925752959189', '1533824053935341598', '1490530623201345556', '1490530523083182250'];
    const onlineStaff = guild ? guild.members.cache.filter(m => !m.user.bot && m.presence?.status !== 'offline' && m.roles.cache.some(r => staffRoles.includes(r.id))).map(m => ({ username: m.user.username, displayName: m.displayName, roles: m.roles.cache.filter(r => staffRoles.includes(r.id)).map(r => r.name) })) : [];
    res.json({ staffOnline: onlineStaff });
});

app.post('/api/log', verifyApi, async (req, res) => {
    const { source, level, message, details } = req.body;
    const colors = { info: '#003DA5', warn: '#D97706', error: '#DC2626', success: '#059669' };
    const logFields = details ? [{ name: 'Détails', value: `\`\`\`json\n${JSON.stringify(details, null, 2).substring(0, 1000)}\n\`\`\`` }] : [];
    await sendLog(`📝 Log: ${source.toUpperCase()}`, message, colors[level] || '#003DA5', logFields);
    res.status(200).json({ success: true });
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

client.pendingEmbeds = new Map();
client.tempVoiceChannels = new Map();

// ==========================================
// 5. GESTION DES ERREURS GLOBALES
// ==========================================
process.on('uncaughtException', (error) => {
    console.error('CRASH:', error);
    sendLog('🚨 CRITIQUE : Bot Crashé', `\`\`\`js\n${error.message}\n${error.stack}\n\`\`\``, '#DC2626');
});

process.on('unhandledRejection', (reason) => {
    console.error('Unhandled Rejection:', reason);
    sendLog('⚠️ AVERTISSEMENT : Erreur de Promesse', `\`\`\`js\n${reason}\n\`\`\``, '#DC2626');
});

// ==========================================
// 6. MODULES CARL-BOT - LOGS AUTOMATIQUES
// ==========================================
client.on('guildMemberAdd', async member => {
    if (db.welcome.enabled && db.welcome.channel) {
        const channel = client.channels.cache.get(db.welcome.channel);
        if (channel) {
            const msg = db.welcome.message.replace('{user}', `<@${member.id}>`).replace('{guild}', member.guild.name);
            await channel.send(msg);
        }
    }
    if (db.autoroles.has('join')) {
        const roles = db.autoroles.get('join');
        for (const roleId of roles) {
            try { await member.roles.add(roleId); } catch (e) {}
        }
    }
    await sendLog('📥 Nouveau Membre', `**${member.user.tag}** a rejoint le serveur.`, '#059669', [
        { name: 'Identifiant', value: member.id, inline: true },
        { name: 'Compte créé', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, inline: true },
        { name: 'Membres totaux', value: `${member.guild.memberCount}`, inline: true }
    ], member.user.displayAvatarURL({ size: 256, dynamic: true }));
    await sendServerLog('Membre Rejoint', `**${member.user.tag}** (\`${member.id}\`) a rejoint le serveur.\n**Compte créé :** <t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, '#059669');
});

client.on('guildMemberRemove', async member => {
    if (db.leave.enabled && db.leave.channel) {
        const channel = client.channels.cache.get(db.leave.channel);
        if (channel) {
            const msg = db.leave.message.replace('{user}', `<@${member.id}>`).replace('{guild}', member.guild.name);
            await channel.send(msg);
        }
    }
    await sendLog('📤 Membre Parti', `**${member.user.tag}** a quitté le serveur.`, '#DC2626', [
        { name: 'Identifiant', value: member.id, inline: true },
        { name: 'A rejoint le', value: member.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>` : 'Inconnu', inline: true }
    ], member.user.displayAvatarURL({ size: 256, dynamic: true }));
    await sendServerLog('Membre Parti', `**${member.user.tag}** (\`${member.id}\`) a quitté le serveur.\n**A rejoint le :** ${member.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>` : 'Inconnu'}`, '#DC2626');
});

client.on('guildMemberUpdate', async (oldMember, newMember) => {
    if (oldMember.nickname !== newMember.nickname) {
        await sendLog('✏️ Pseudo Modifié', `**${newMember.user.tag}** a changé de pseudo.`, '#D97706', [
            { name: 'Ancien', value: oldMember.nickname || 'Aucun', inline: true },
            { name: 'Nouveau', value: newMember.nickname || 'Aucun', inline: true }
        ], newMember.user.displayAvatarURL({ size: 256, dynamic: true }));
        await sendServerLog('Pseudo Modifié', `**${newMember.user.tag}**\nAncien: \`${oldMember.nickname || 'Aucun'}\`\nNouveau: \`${newMember.nickname || 'Aucun'}\``, '#D97706');
    }
    const added = newMember.roles.cache.filter(r => !oldMember.roles.cache.has(r.id));
    const removed = oldMember.roles.cache.filter(r => !newMember.roles.cache.has(r.id));
    if (added.size > 0) {
        await sendLog('➕ Rôle Ajouté', `**${newMember.user.tag}** a reçu des rôles.`, '#D97706', [{ name: 'Rôles', value: added.map(r => r.name).join(', ') }], newMember.user.displayAvatarURL({ size: 256, dynamic: true }));
        await sendServerLog('Rôle Ajouté', `**${newMember.user.tag}**\nRôles: ${added.map(r => r.name).join(', ')}`, '#D97706');
    }
    if (removed.size > 0) {
        await sendLog('➖ Rôle Retiré', `**${newMember.user.tag}** a perdu des rôles.`, '#D97706', [{ name: 'Rôles', value: removed.map(r => r.name).join(', ') }], newMember.user.displayAvatarURL({ size: 256, dynamic: true }));
        await sendServerLog('Rôle Retiré', `**${newMember.user.tag}**\nRôles: ${removed.map(r => r.name).join(', ')}`, '#D97706');
    }
});

client.on('messageDelete', async message => {
    if (!message.author || message.author.bot || !message.content) return;
    await sendLog('🗑️ Message Supprimé', `Un message a été supprimé.`, '#DC2626', [
        { name: 'Auteur', value: `${message.author.tag}`, inline: true },
        { name: 'Canal', value: `<#${message.channel.id}>`, inline: true },
        { name: 'Contenu', value: message.content.substring(0, 1000), inline: false }
    ], message.author.displayAvatarURL({ size: 256, dynamic: true }));
});

client.on('messageUpdate', async (oldMessage, newMessage) => {
    if (!newMessage.author || newMessage.author.bot || oldMessage.content === newMessage.content) return;
    await sendLog('✏️ Message Modifié', `Un message a été édité.`, '#D97706', [
        { name: 'Auteur', value: `${newMessage.author.tag}`, inline: true },
        { name: 'Canal', value: `<#${newMessage.channel.id}>`, inline: true },
        { name: 'Ancien', value: oldMessage.content?.substring(0, 500) || '*Aucun*', inline: false },
        { name: 'Nouveau', value: newMessage.content?.substring(0, 500) || '*Aucun*', inline: false }
    ], newMessage.author.displayAvatarURL({ size: 256, dynamic: true }));
});

client.on('guildBanAdd', async ban => {
    await sendLog('🔨 Membre Banni', `Un membre a été banni.`, '#DC2626', [
        { name: 'Utilisateur', value: `${ban.user.tag} (${ban.user.id})`, inline: true },
        { name: 'Raison', value: ban.reason || 'Aucune', inline: true }
    ], ban.user.displayAvatarURL({ size: 256, dynamic: true }));
    await sendServerLog('Membre Banni', `**${ban.user.tag}** (\`${ban.user.id}\`)\nRaison: ${ban.reason || 'Aucune'}`, '#DC2626');
});

client.on('guildBanRemove', async ban => {
    await sendLog('✅ Ban Retiré', `Le ban de **${ban.user.tag}** a été levé.`, '#059669', [
        { name: 'Utilisateur', value: `${ban.user.tag} (${ban.user.id})`, inline: true }
    ], ban.user.displayAvatarURL({ size: 256, dynamic: true }));
    await sendServerLog('Ban Retiré', `**${ban.user.tag}** (\`${ban.user.id}\`)`, '#059669');
});

client.on('channelCreate', async channel => {
    await sendServerLog('Salon Créé', `**#${channel.name}**\nType: ${ChannelType[channel.type]}`, '#059669');
});

client.on('channelDelete', async channel => {
    await sendServerLog('Salon Supprimé', `**#${channel.name}**\nType: ${ChannelType[channel.type]}`, '#DC2626');
});

client.on('channelUpdate', async (oldChannel, newChannel) => {
    if (oldChannel.name !== newChannel.name) {
        await sendServerLog('Salon Renommé', `**#${oldChannel.name}** → **#${newChannel.name}**`, '#D97706');
    }
});

client.on('roleCreate', async role => {
    await sendServerLog('Rôle Créé', `**@${role.name}**\nCouleur: ${role.hexColor}`, '#059669');
});

client.on('roleDelete', async role => {
    await sendServerLog('Rôle Supprimé', `**@${role.name}**\nCouleur: ${role.hexColor}`, '#DC2626');
});

// ==========================================
// 7. MODULES CARL-BOT - MESSAGES & AUTOMOD
// ==========================================
client.on('messageCreate', async message => {
    if (message.author.bot) return;
    if (!message.guild) return;

    if (message.mentions.users.size > 0) {
        for (const [userId, afkData] of db.afk) {
            if (message.mentions.users.has(userId)) {
                await message.reply(`${afkData.username} est AFK : ${afkData.reason} (depuis <t:${Math.floor(afkData.timestamp / 1000)}:R>)`);
            }
        }
    }
    if (db.afk.has(message.author.id)) {
        db.afk.delete(message.author.id);
        await message.reply(`Bienvenue de retour ${message.author} ! Tu n'es plus AFK.`);
        if (message.member.displayName.startsWith('[AFK] ')) {
            await message.member.setNickname(message.member.displayName.replace('[AFK] ', '')).catch(() => {});
        }
    }

    const xpGain = Math.floor(Math.random() * 20) + 10;
    const newLevel = addXP(message.author.id, xpGain);
    if (newLevel) {
        await message.reply(`🎉 Félicitations **${message.author}** ! Tu es passé au niveau **${newLevel}** !`);
    }

    const ecoData = getEconomy(message.author.id);
    if (Math.random() < 0.1) {
        ecoData.coins += Math.floor(Math.random() * 5) + 1;
    }

    const content = message.content.toLowerCase();
    if (db.automod.badWords.some(word => content.includes(word))) {
        await message.delete().catch(() => {});
        await message.reply('⚠️ Ton message contient des mots interdits.');
        await sendLog('🤖 Automod', `**${message.author.tag}** a envoyé un message avec des mots interdits.`, '#DC2626', [], message.author.displayAvatarURL({ size: 256 }));
        return;
    }

    for (const [trigger, response] of db.autoresponders) {
        if (content.includes(trigger.toLowerCase())) {
            await message.reply(response);
            return;
        }
    }

    if (content.startsWith('!')) {
        const cmdName = content.slice(1).split(' ')[0].toLowerCase();
        if (db.customCommands.has(cmdName)) {
            const cmd = db.customCommands.get(cmdName);
            await message.reply(cmd.response);
            return;
        }
    }

    if (content.startsWith('!tag ')) {
        const tagName = content.slice(5).toLowerCase();
        if (db.tags.has(tagName)) {
            await message.reply(db.tags.get(tagName));
            return;
        }
    }

    if (db.autoDelete.has(message.channel.id)) {
        const delay = db.autoDelete.get(message.channel.id);
        setTimeout(() => { message.delete().catch(() => {}); }, delay * 1000);
    }

    if (db.starboard.has(message.channel.id)) {
        const config = db.starboard.get(message.channel.id);
        if (message.reactions.cache.get(config.emoji)?.count >= config.threshold) {
            const starChannel = client.channels.cache.get(config.channel);
            if (starChannel) {
                await starChannel.send(`⭐ **${message.author.tag}** : ${message.content}\n[Message original](${message.url})`);
            }
        }
    }

    for (const [userId, keywords] of db.highlights) {
        if (userId === message.author.id) continue;
        for (const keyword of keywords) {
            if (message.content.toLowerCase().includes(keyword.toLowerCase())) {
                const user = client.users.cache.get(userId);
                if (user) {
                    await user.send(`🔔 **Mot-clé détecté** dans <#${message.channel.id}> :\n"${message.content.substring(0, 100)}..."`).catch(() => {});
                }
            }
        }
    }

    if (db.counting.enabled && message.channel.id === db.counting.channel) {
        const num = parseInt(message.content);
        if (!isNaN(num)) {
            if (num === db.counting.current + 1) {
                db.counting.current = num;
                db.counting.lastUser = message.author.id;
            } else {
                db.counting.current = 0;
                await message.reply(`❌ Mauvais nombre ! On recommence à 0.`);
            }
        }
    }
});

// ==========================================
// 8. MODULES CARL-BOT - VOIX & RÉACTIONS
// ==========================================
client.on('voiceStateUpdate', async (oldState, newState) => {
    const member = newState.member;
    if (!member) return;

    if (!oldState.channel && newState.channel) {
        if (db.voiceTextChannels.has(newState.channel.id)) {
            const textChannelId = db.voiceTextChannels.get(newState.channel.id);
            const textChannel = client.channels.cache.get(textChannelId);
            if (textChannel) {
                await textChannel.send(`🎤 **${member.user.tag}** a rejoint le salon vocal.`);
            }
        }
    }

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
            await sendLog('🎤 Vocal Temporaire Créé', `**${displayName}** a créé <#${newChannel.id}>.`, '#059669', [], member.user.displayAvatarURL({ size: 256 }));
        } catch (error) { 
            await sendLog('❌ Erreur Vocal', `Échec:\n\`\`\`js\n${error.message}\n\`\`\``, '#DC2626');
        }
    }
    if (oldState.channelId && client.tempVoiceChannels.has(oldState.channelId)) {
        const channel = oldState.channel;
        if (channel && channel.members.size === 0) {
            await channel.delete().catch(console.error);
            client.tempVoiceChannels.delete(oldState.channelId);
            await sendLog('🗑️ Vocal Supprimé', `Le salon temporaire a été supprimé car vide.`, '#DC2626');
        }
    }

    if (!oldState.channel && newState.channel) {
        const roleId = db.reactionRoles.get(`voice_${newState.channel.id}`);
        if (roleId) {
            try { await member.roles.add(roleId); } catch (e) {}
        }
    }
    if (oldState.channel && !newState.channel) {
        const roleId = db.reactionRoles.get(`voice_${oldState.channel.id}`);
        if (roleId) {
            try { await member.roles.remove(roleId); } catch (e) {}
        }
    }
});

client.on('messageReactionAdd', async (reaction, user) => {
    if (user.bot) return;
    const key = `${reaction.message.id}_${reaction.emoji.name}`;
    if (db.reactionRoles.has(key)) {
        const roleId = db.reactionRoles.get(key);
        try { await reaction.message.guild.members.cache.get(user.id).roles.add(roleId); } catch (e) {}
    }
    if (db.starboard.has(reaction.message.channel.id)) {
        const config = db.starboard.get(reaction.message.channel.id);
        if (reaction.emoji.name === config.emoji && reaction.count >= config.threshold) {
            const starChannel = client.channels.cache.get(config.channel);
            if (starChannel) {
                await starChannel.send(`⭐ **${user.tag}** : ${reaction.message.content}\n[Message](${reaction.message.url})`);
            }
        }
    }
});

client.on('messageReactionRemove', async (reaction, user) => {
    if (user.bot) return;
    const key = `${reaction.message.id}_${reaction.emoji.name}`;
    if (db.reactionRoles.has(key)) {
        const roleId = db.reactionRoles.get(key);
        try { await reaction.message.guild.members.cache.get(user.id).roles.remove(roleId); } catch (e) {}
    }
});

// ==========================================
// 9. COMMANDES SLASH
// ==========================================
const commands = [
    new SlashCommandBuilder().setName('ping').setDescription('Vérifie la latence du bot.'),
    new SlashCommandBuilder().setName('help').setDescription('Affiche la liste des commandes.'),
    new SlashCommandBuilder().setName('invite').setDescription('Obtenir le lien d\'invitation du bot.'),
    new SlashCommandBuilder().setName('avatar').setDescription('Voir l\'avatar d\'un utilisateur.').addUserOption(o => o.setName('utilisateur').setDescription('L\'utilisateur')),
    new SlashCommandBuilder().setName('banner').setDescription('Voir la bannière d\'un utilisateur.').addUserOption(o => o.setName('utilisateur').setDescription('L\'utilisateur')),
    new SlashCommandBuilder().setName('serverbanner').setDescription('Voir la bannière du serveur.'),
    new SlashCommandBuilder().setName('roleinfo').setDescription('Infos sur un rôle.').addRoleOption(o => o.setName('role').setDescription('Le rôle').setRequired(true)),
    new SlashCommandBuilder().setName('channelinfo').setDescription('Infos sur un salon.').addChannelOption(o => o.setName('salon').setDescription('Le salon')),
    new SlashCommandBuilder().setName('say').setDescription('Faire dire quelque chose au bot.').addStringOption(o => o.setName('message').setDescription('Le message').setRequired(true)),
    new SlashCommandBuilder().setName('announce').setDescription('Créer une annonce.').addStringOption(o => o.setName('titre').setDescription('Titre').setRequired(true)).addStringOption(o => o.setName('description').setDescription('Description').setRequired(true)).addChannelOption(o => o.setName('salon').setDescription('Salon').setRequired(true)),
    new SlashCommandBuilder().setName('poll').setDescription('Créer un sondage.').addStringOption(o => o.setName('question').setDescription('La question').setRequired(true)).addStringOption(o => o.setName('options').setDescription('Options séparées par des virgules').setRequired(true)),
    new SlashCommandBuilder().setName('suggest').setDescription('Faire une suggestion.').addStringOption(o => o.setName('suggestion').setDescription('Ta suggestion').setRequired(true)),
    new SlashCommandBuilder().setName('8ball').setDescription('Pose une question à la boule magique.').addStringOption(o => o.setName('question').setDescription('Ta question').setRequired(true)),
    new SlashCommandBuilder().setName('coinflip').setDescription('Pile ou face.'),
    new SlashCommandBuilder().setName('dice').setDescription('Lancer un dé.'),
    new SlashCommandBuilder().setName('rps').setDescription('Pierre papier ciseaux.').addStringOption(o => o.setName('choix').setDescription('Pierre, papier ou ciseaux').setRequired(true).addChoices({ name: 'Pierre', value: 'pierre' }, { name: 'Papier', value: 'papier' }, { name: 'Ciseaux', value: 'ciseaux' })),
    new SlashCommandBuilder().setName('remind').setDescription('Définir un rappel.').addIntegerOption(o => o.setName('minutes').setDescription('Dans combien de minutes').setRequired(true)).addStringOption(o => o.setName('message').setDescription('Le rappel').setRequired(true)),
    new SlashCommandBuilder().setName('afk').setDescription('Définir ton statut AFK.').addStringOption(o => o.setName('raison').setDescription('Raison de ton AFK')),
    new SlashCommandBuilder().setName('meme').setDescription('Meme aléatoire.'),
    new SlashCommandBuilder().setName('cat').setDescription('Image de chat aléatoire.'),
    new SlashCommandBuilder().setName('dog').setDescription('Image de chien aléatoire.'),
    new SlashCommandBuilder().setName('embed').setDescription('Crée un embed interactif avec previsualisation.'),
    new SlashCommandBuilder().setName('ticket').setDescription('Ouvre un ticket de support.'),
    new SlashCommandBuilder().setName('close').setDescription('Ferme le ticket actuel.').setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
    new SlashCommandBuilder().setName('warn').setDescription('Avertir un membre.').setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers).addUserOption(o => o.setName('membre').setDescription('Le membre').setRequired(true)).addStringOption(o => o.setName('raison').setDescription('Raison').setRequired(true)),
    new SlashCommandBuilder().setName('clear').setDescription('Supprime des messages.').setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages).addIntegerOption(o => o.setName('nombre').setDescription('Nombre (max 100)').setRequired(true).setMinValue(1).setMaxValue(100)),
    new SlashCommandBuilder().setName('userinfo').setDescription('Affiche les informations d\'un utilisateur.').addUserOption(o => o.setName('membre').setDescription('Le membre')),
    new SlashCommandBuilder().setName('serverinfo').setDescription('Affiche les informations du serveur.'),
    new SlashCommandBuilder().setName('matricule').setDescription('Définit ou met à jour votre matricule.').addStringOption(o => o.setName('numero').setDescription('Numéro (ex: 12-43)').setRequired(true)),
    new SlashCommandBuilder().setName('lockvc').setDescription('Verrouiller le salon vocal.'),
    new SlashCommandBuilder().setName('unlockvc').setDescription('Déverrouiller le salon vocal.'),
    new SlashCommandBuilder().setName('hidevc').setDescription('Cacher le salon vocal.'),
    new SlashCommandBuilder().setName('showvc').setDescription('Rendre le salon vocal visible.'),
    new SlashCommandBuilder().setName('limitvc').setDescription('Limiter le nombre de personnes.').addIntegerOption(o => o.setName('limite').setDescription('Maximum (0 = illimité)').setRequired(true).setMinValue(0).setMaxValue(99)),
    new SlashCommandBuilder().setName('renamevc').setDescription('Renommer le salon vocal.').addStringOption(o => o.setName('nom').setDescription('Nouveau nom').setRequired(true)),
    new SlashCommandBuilder().setName('kickvc').setDescription('Kick quelqu\'un du salon vocal.').addUserOption(o => o.setName('membre').setDescription('Le membre').setRequired(true)),
    new SlashCommandBuilder().setName('banvc').setDescription('Bannir quelqu\'un du salon vocal.').addUserOption(o => o.setName('membre').setDescription('Le membre').setRequired(true)),
    new SlashCommandBuilder().setName('unbanvc').setDescription('Débannir quelqu\'un du salon vocal.').addUserOption(o => o.setName('membre').setDescription('Le membre').setRequired(true)),
    new SlashCommandBuilder().setName('claimvc').setDescription('Réclamer la propriété du salon.'),
    new SlashCommandBuilder().setName('vcinfo').setDescription('Voir les infos du salon vocal.'),
    new SlashCommandBuilder().setName('scan').setDescription('Scanner complet du serveur en 5 fichiers (Jacobin904 uniquement)'),
    new SlashCommandBuilder().setName('test').setDescription('Test embed avec boutons'),
    new SlashCommandBuilder().setName('rank').setDescription('Voir ton rang et ton XP.'),
    new SlashCommandBuilder().setName('leaderboard').setDescription('Voir le classement XP.'),
    new SlashCommandBuilder().setName('balance').setDescription('Voir ton solde.'),
    new SlashCommandBuilder().setName('daily').setDescription('Réclamer ta récompense quotidienne.'),
    new SlashCommandBuilder().setName('give').setDescription('Donner des coins à quelqu\'un.').addUserOption(o => o.setName('utilisateur').setDescription('L\'utilisateur').setRequired(true)).addIntegerOption(o => o.setName('montant').setDescription('Montant').setRequired(true)),
    new SlashCommandBuilder().setName('kick').setDescription('Expulser un membre.').setDefaultMemberPermissions(PermissionFlagsBits.KickMembers).addUserOption(o => o.setName('membre').setDescription('Le membre').setRequired(true)).addStringOption(o => o.setName('raison').setDescription('Raison')),
    new SlashCommandBuilder().setName('ban').setDescription('Bannir un membre.').setDefaultMemberPermissions(PermissionFlagsBits.BanMembers).addUserOption(o => o.setName('membre').setDescription('Le membre').setRequired(true)).addStringOption(o => o.setName('raison').setDescription('Raison')),
    new SlashCommandBuilder().setName('unban').setDescription('Débannir un membre.').setDefaultMemberPermissions(PermissionFlagsBits.BanMembers).addStringOption(o => o.setName('userid').setDescription('ID de l\'utilisateur').setRequired(true)),
    new SlashCommandBuilder().setName('mute').setDescription('Rendre un membre muet.').setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers).addUserOption(o => o.setName('membre').setDescription('Le membre').setRequired(true)).addIntegerOption(o => o.setName('durée').setDescription('Durée en minutes').setRequired(true)),
    new SlashCommandBuilder().setName('unmute').setDescription('Retirer le mute d\'un membre.').setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers).addUserOption(o => o.setName('membre').setDescription('Le membre').setRequired(true)),
    new SlashCommandBuilder().setName('giveaway').setDescription('Créer un giveaway.').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild).addStringOption(o => o.setName('prix').setDescription('Le prix').setRequired(true)).addIntegerOption(o => o.setName('durée').setDescription('Durée en minutes').setRequired(true)).addIntegerOption(o => o.setName('gagnants').setDescription('Nombre de gagnants').setRequired(true)),
    new SlashCommandBuilder().setName('tag').setDescription('Afficher un tag.').addStringOption(o => o.setName('nom').setDescription('Nom du tag').setRequired(true)),
    new SlashCommandBuilder().setName('tagadd').setDescription('Créer un tag.').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild).addStringOption(o => o.setName('nom').setDescription('Nom').setRequired(true)).addStringOption(o => o.setName('contenu').setDescription('Contenu').setRequired(true)),
    new SlashCommandBuilder().setName('tagdelete').setDescription('Supprimer un tag.').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild).addStringOption(o => o.setName('nom').setDescription('Nom').setRequired(true)),
    new SlashCommandBuilder().setName('ccadd').setDescription('Créer une commande custom.').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild).addStringOption(o => o.setName('nom').setDescription('Nom (sans !)').setRequired(true)).addStringOption(o => o.setName('réponse').setDescription('Réponse').setRequired(true)),
    new SlashCommandBuilder().setName('ccdelete').setDescription('Supprimer une commande custom.').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild).addStringOption(o => o.setName('nom').setDescription('Nom').setRequired(true)),
    new SlashCommandBuilder().setName('aradd').setDescription('Créer un auto-responder.').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild).addStringOption(o => o.setName('déclencheur').setDescription('Mot déclencheur').setRequired(true)).addStringOption(o => o.setName('réponse').setDescription('Réponse').setRequired(true)),
    new SlashCommandBuilder().setName('ardelete').setDescription('Supprimer un auto-responder.').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild).addStringOption(o => o.setName('déclencheur').setDescription('Mot déclencheur').setRequired(true)),
    new SlashCommandBuilder().setName('rradd').setDescription('Ajouter un reaction role.').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild).addStringOption(o => o.setName('messageid').setDescription('ID du message').setRequired(true)).addStringOption(o => o.setName('emoji').setDescription('Emoji').setRequired(true)).addRoleOption(o => o.setName('role').setDescription('Rôle').setRequired(true)),
    new SlashCommandBuilder().setName('starboard').setDescription('Configurer le starboard.').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild).addChannelOption(o => o.setName('salon').setDescription('Salon starboard').setRequired(true)).addIntegerOption(o => o.setName('seuil').setDescription('Nombre de réactions').setRequired(true)),
    new SlashCommandBuilder().setName('slowmode').setDescription('Définir le slowmode.').setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels).addIntegerOption(o => o.setName('secondes').setDescription('Secondes (0 pour désactiver)').setRequired(true)),
    new SlashCommandBuilder().setName('autodelete').setDescription('Suppression auto des messages.').setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels).addIntegerOption(o => o.setName('secondes').setDescription('Secondes (0 pour désactiver)').setRequired(true)),
    new SlashCommandBuilder().setName('highlight').setDescription('Gérer tes mots-clés.').addSubcommand(s => s.setName('add').setDescription('Ajouter un mot-clé').addStringOption(o => o.setName('mot').setDescription('Mot-clé').setRequired(true))).addSubcommand(s => s.setName('remove').setDescription('Retirer un mot-clé').addStringOption(o => o.setName('mot').setDescription('Mot-clé').setRequired(true))).addSubcommand(s => s.setName('list').setDescription('Lister tes mots-clés')),
    new SlashCommandBuilder().setName('form').setDescription('Créer un formulaire.').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild).addStringOption(o => o.setName('titre').setDescription('Titre').setRequired(true)).addChannelOption(o => o.setName('salon').setDescription('Salon de destination').setRequired(true)),
    new SlashCommandBuilder().setName('welcome').setDescription('Configurer le message de bienvenue.').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild).addChannelOption(o => o.setName('salon').setDescription('Salon de bienvenue').setRequired(true)).addStringOption(o => o.setName('message').setDescription('Message ({user} et {guild})').setRequired(true)),
    new SlashCommandBuilder().setName('autorole').setDescription('Configurer les autoroles.').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild).addRoleOption(o => o.setName('role').setDescription('Rôle à ajouter').setRequired(true)),
    new SlashCommandBuilder().setName('automod').setDescription('Gérer l\'automodération.').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild).addSubcommand(s => s.setName('addword').setDescription('Ajouter un mot interdit').addStringOption(o => o.setName('mot').setDescription('Mot').setRequired(true))).addSubcommand(s => s.setName('removeword').setDescription('Retirer un mot interdit').addStringOption(o => o.setName('mot').setDescription('Mot').setRequired(true))),
    new SlashCommandBuilder().setName('modlog').setDescription('Configurer le salon de modlog.').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild).addChannelOption(o => o.setName('salon').setDescription('Salon de modlog').setRequired(true)),
    new SlashCommandBuilder().setName('serverlog').setDescription('Configurer le salon de serverlog.').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild).addChannelOption(o => o.setName('salon').setDescription('Salon de serverlog').setRequired(true)),
    new SlashCommandBuilder().setName('warnings').setDescription('Voir tes avertissements.').addUserOption(o => o.setName('utilisateur').setDescription('L\'utilisateur')),
    new SlashCommandBuilder().setName('selfrole').setDescription('Ajouter un self-role.').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild).addRoleOption(o => o.setName('role').setDescription('Rôle').setRequired(true)),
    new SlashCommandBuilder().setName('counting').setDescription('Configurer le counting.').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild).addChannelOption(o => o.setName('salon').setDescription('Salon de counting').setRequired(true)),
    new SlashCommandBuilder().setName('trivia').setDescription('Démarrer un trivia.').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild).addChannelOption(o => o.setName('salon').setDescription('Salon de trivia').setRequired(true))
];

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

client.once('clientReady', async () => {
    try {
        await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), { body: commands.map(cmd => cmd.toJSON()) });
        await sendLog('✅ Bot Démarré', `Le système est en ligne.\n**Identité :** ${client.user.tag}\n**Serveurs :** ${client.guilds.cache.size}\n**Membres totaux :** ${client.guilds.cache.reduce((acc, g) => acc + g.memberCount, 0)}`, '#059669', [], client.user.displayAvatarURL({ size: 256 }));
    } catch (error) {
        await sendLog('❌ Erreur Démarrage', `Échec:\n\`\`\`js\n${error.message}\n\`\`\``, '#DC2626');
    }
});

// ==========================================
// 10. GESTION DES INTERACTIONS
// ==========================================
client.on('interactionCreate', async interaction => {
    if (interaction.isChatInputCommand()) {
        const options = interaction.options.data.map(o => `${o.name}: ${o.value}`).join('\n') || 'Aucune';
        await sendLog('⚡ Commande', `**${interaction.user.tag}** a utilisé \`/${interaction.commandName}\`\nDans: <#${interaction.channel.id}>`, '#4d8dff', [{ name: 'Options', value: options }], interaction.user.displayAvatarURL({ size: 256, dynamic: true }));

        if (interaction.commandName === 'ping') {
            await interaction.reply({ embeds: [createEmbed('🏓 Pong !', `Latence : **${client.ws.ping}ms**`, '#003DA5')] });
        }
        
        if (interaction.commandName === 'help') {
            await interaction.reply({ embeds: [createEmbed('📖 Centre d\'aide', 'Liste complète des commandes.', '#003DA5', [
                { name: '🎤 Gestion Vocale', value: '`/lockvc` `/unlockvc` `/hidevc` `/showvc` `/limitvc` `/renamevc` `/kickvc` `/banvc` `/unbanvc` `/claimvc` `/vcinfo`', inline: false },
                { name: '🎮 Divertissement', value: '`/8ball` `/coinflip` `/dice` `/rps` `/meme` `/cat` `/dog`', inline: false },
                { name: '📊 Levels & Économie', value: '`/rank` `/leaderboard` `/balance` `/daily` `/give`', inline: false },
                { name: '🛡️ Modération', value: '`/warn` `/kick` `/ban` `/unban` `/mute` `/unmute` `/clear` `/ticket` `/close`', inline: false },
                { name: '⚙️ Configuration', value: '`/autorole` `/automod` `/slowmode` `/autodelete` `/starboard` `/welcome` `/modlog` `/serverlog`', inline: false },
                { name: '🔧 Utilitaires', value: '`/help` `/avatar` `/banner` `/roleinfo` `/channelinfo` `/invite` `/suggest` `/poll` `/say` `/announce` `/remind` `/afk` `/tag` `/ccadd` `/aradd`', inline: false }
            ])], ephemeral: true });
        }

        if (interaction.commandName === 'invite') {
            await interaction.reply({ embeds: [createEmbed('🔗 Invitation', `[Clique ici pour inviter le bot](https://discord.com/api/oauth2/authorize?client_id=${client.user.id}&permissions=8&scope=bot%20applications.commands)`, '#003DA5')] });
        }

        if (interaction.commandName === 'avatar') {
            const user = interaction.options.getUser('utilisateur') || interaction.user;
            await interaction.reply({ embeds: [createEmbed(`Avatar de ${user.username}`, `Voici l'avatar de **${user.username}**.`, '#003DA5', [], user.displayAvatarURL({ size: 4096, dynamic: true }))] });
        }

        if (interaction.commandName === 'banner') {
            const user = interaction.options.getUser('utilisateur') || interaction.user;
            const fetchedUser = await client.users.fetch(user.id, { force: true });
            if (fetchedUser.banner) {
                const embed = createEmbed(`Bannière de ${user.username}`, `Voici la bannière de **${user.username}**.`, '#003DA5', [], user.displayAvatarURL({ size: 256, dynamic: true }));
                embed.setImage(fetchedUser.bannerURL({ size: 4096, dynamic: true }));
                await interaction.reply({ embeds: [embed] });
            } else {
                await interaction.reply({ embeds: [createEmbed('❌ Non trouvé', 'Cet utilisateur n\'a pas de bannière.', '#DC2626')], ephemeral: true });
            }
        }

        if (interaction.commandName === 'serverbanner') {
            const banner = interaction.guild.bannerURL({ size: 4096, dynamic: true });
            if (banner) {
                const embed = createEmbed(`Bannière de ${interaction.guild.name}`, `Voici la bannière officielle.`, '#003DA5');
                embed.setImage(banner);
                await interaction.reply({ embeds: [embed] });
            } else {
                await interaction.reply({ embeds: [createEmbed('❌ Non trouvé', 'Ce serveur n\'a pas de bannière.', '#DC2626')], ephemeral: true });
            }
        }

        if (interaction.commandName === 'roleinfo') {
            const role = interaction.options.getRole('role');
            await interaction.reply({ embeds: [createEmbed(`🎭 Rôle : ${role.name}`, `Détails du rôle **@${role.name}**.`, role.color || '#003DA5', [
                { name: '🆔 Identifiant', value: role.id, inline: true },
                { name: '📊 Position', value: `${role.position}`, inline: true },
                { name: '👥 Membres', value: `${role.members.size}`, inline: true }
            ])] });
        }

        if (interaction.commandName === 'channelinfo') {
            const channel = interaction.options.getChannel('salon') || interaction.channel;
            await interaction.reply({ embeds: [createEmbed(`💬 Salon : ${channel.name}`, `Détails du salon **#${channel.name}**.`, '#003DA5', [
                { name: '🆔 Identifiant', value: channel.id, inline: true },
                { name: '📂 Type', value: ChannelType[channel.type], inline: true }
            ])] });
        }

        if (interaction.commandName === 'say') {
            await interaction.channel.send(interaction.options.getString('message'));
            await interaction.reply({ embeds: [createEmbed('✅ Succès', 'Le message a été envoyé.', '#059669')], ephemeral: true });
        }

        if (interaction.commandName === 'announce') {
            const titre = interaction.options.getString('titre');
            const description = interaction.options.getString('description');
            const channel = interaction.options.getChannel('salon');
            const embed = createEmbed(titre, description, '#003DA5').setFooter({ text: `Annonce par ${interaction.user.username}`, iconURL: interaction.user.displayAvatarURL({ size: 256 }) });
            await channel.send({ embeds: [embed] });
            await interaction.reply({ embeds: [createEmbed('✅ Succès', `Annonce envoyée dans ${channel}.`, '#059669')], ephemeral: true });
        }

        if (interaction.commandName === 'poll') {
            const question = interaction.options.getString('question');
            const options = interaction.options.getString('options').split(',').map(o => o.trim());
            if (options.length < 2 || options.length > 10) {
                return interaction.reply({ embeds: [createEmbed('❌ Erreur', 'Veuillez fournir entre 2 et 10 options.', '#DC2626')], ephemeral: true });
            }
            const emojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
            const embed = createEmbed(`📊 Sondage : ${question}`, options.map((opt, i) => `${emojis[i]} ${opt}`).join('\n'), '#003DA5').setFooter({ text: `Sondage par ${interaction.user.username}`, iconURL: interaction.user.displayAvatarURL({ size: 256 }) });
            const message = await interaction.reply({ embeds: [embed], fetchReply: true });
            for (let i = 0; i < options.length; i++) await message.react(emojis[i]);
        }

        if (interaction.commandName === 'suggest') {
            const suggestion = interaction.options.getString('suggestion');
            const suggestChannel = interaction.guild.channels.cache.find(c => c.name === 'suggestions');
            if (!suggestChannel) {
                return interaction.reply({ embeds: [createEmbed('❌ Erreur', 'Le salon #suggestions n\'existe pas.', '#DC2626')], ephemeral: true });
            }
            const embed = createEmbed('💡 Nouvelle suggestion', suggestion, '#003DA5').setFooter({ text: `Par ${interaction.user.username}`, iconURL: interaction.user.displayAvatarURL({ size: 256 }) });
            const message = await suggestChannel.send({ embeds: [embed] });
            await message.react('✅'); await message.react('❌');
            await interaction.reply({ embeds: [createEmbed('✅ Succès', 'Ta suggestion a été envoyée !', '#059669')], ephemeral: true });
        }

        if (interaction.commandName === '8ball') {
            const responses = ['Oui, absolument !', 'Non, jamais.', 'Peut-être...', 'C\'est certain.', 'Je ne pense pas.', 'Absolument !', 'Demande plus tard.', 'Concentre-toi et redemande.', 'Ne compte pas dessus.', 'Oui, dans un futur proche.', 'Très douteux.', 'Sans aucun doute.', 'Ma réponse est non.', 'Il est certain que oui.', 'Les perspectives ne sont pas si bonnes.', 'C\'est décidément le cas.', 'Oui, définitivement.', 'Mieux vaut ne pas te le dire maintenant.', 'Mes sources disent non.', 'Oui, tu peux y compter.'];
            await interaction.reply({ embeds: [createEmbed('🎱 Boule Magique', `**Question :** ${interaction.options.getString('question')}\n**Réponse :** ${responses[Math.floor(Math.random() * responses.length)]}`, '#003DA5')] });
        }

        if (interaction.commandName === 'coinflip') {
            const result = Math.random() < 0.5 ? 'Pile' : 'Face';
            await interaction.reply({ embeds: [createEmbed('🪙 Pile ou Face', `Le résultat est : **${result}**`, '#003DA5')] });
        }

        if (interaction.commandName === 'dice') {
            const result = Math.floor(Math.random() * 6) + 1;
            await interaction.reply({ embeds: [createEmbed('🎲 Lancer de dé', `Tu as obtenu : **${result}**`, '#003DA5')] });
        }

        if (interaction.commandName === 'rps') {
            const choix = interaction.options.getString('choix');
            const choixBot = ['pierre', 'papier', 'ciseaux'][Math.floor(Math.random() * 3)];
            const emojis = { pierre: '🪨', papier: '📄', ciseaux: '✂️' };
            let result = choix === choixBot ? 'Match nul !' : ((choix === 'pierre' && choixBot === 'ciseaux') || (choix === 'papier' && choixBot === 'pierre') || (choix === 'ciseaux' && choixBot === 'papier')) ? 'Tu as gagné !' : 'Tu as perdu !';
            await interaction.reply({ embeds: [createEmbed('✂️ Pierre Papier Ciseaux', `${emojis[choix]} vs ${emojis[choixBot]}\n\n**Résultat :** ${result}`, '#003DA5')] });
        }

        if (interaction.commandName === 'remind') {
            const minutes = interaction.options.getInteger('minutes');
            const message = interaction.options.getString('message');
            db.reminders.set(interaction.user.id, { message, time: Date.now() + (minutes * 60 * 1000) });
            await interaction.reply({ embeds: [createEmbed('⏰ Rappel Défini', `Tu seras notifié dans **${minutes} minute(s)** pour : "${message}"`, '#003DA5')], ephemeral: true });
            setTimeout(async () => {
                try { 
                    await interaction.user.send({ embeds: [createEmbed('⏰ Rappel', message, '#003DA5')] }); 
                    db.reminders.delete(interaction.user.id); 
                } catch (e) {}
            }, minutes * 60 * 1000);
        }

        if (interaction.commandName === 'afk') {
            const reason = interaction.options.getString('raison') || 'AFK';
            db.afk.set(interaction.user.id, { username: interaction.user.username, reason, timestamp: Date.now() });
            const newName = `[AFK] ${interaction.member.displayName}`;
            if (newName.length <= 32) await interaction.member.setNickname(newName).catch(() => {});
            await interaction.reply({ embeds: [createEmbed('💤 Statut AFK', `Tu es maintenant AFK pour la raison : **${reason}**`, '#003DA5')] });
        }

        if (interaction.commandName === 'meme') {
            try {
                const res = await axios.get('https://meme-api.com/gimme');
                const embed = createEmbed(res.data.title, '', '#003DA5', [], res.data.url);
                embed.setFooter({ text: `r/${res.data.subreddit}`, iconURL: SERVER_ICON }).setURL(res.data.postLink);
                await interaction.reply({ embeds: [embed] });
            } catch (e) { 
                await interaction.reply({ embeds: [createEmbed('❌ Erreur', 'Impossible de récupérer un meme.', '#DC2626')], ephemeral: true }); 
            }
        }

        if (interaction.commandName === 'cat') {
            try {
                const res = await axios.get('https://api.thecatapi.com/v1/images/search');
                await interaction.reply({ embeds: [createEmbed('🐱 Chat Aléatoire', 'Voici un chat mignon !', '#003DA5', [], res.data[0].url)] });
            } catch (e) { 
                await interaction.reply({ embeds: [createEmbed('❌ Erreur', 'Impossible de récupérer une image.', '#DC2626')], ephemeral: true }); 
            }
        }

        if (interaction.commandName === 'dog') {
            try {
                const res = await axios.get('https://dog.ceo/api/breeds/image/random');
                await interaction.reply({ embeds: [createEmbed('🐶 Chien Aléatoire', 'Voici un toutou adorable !', '#003DA5', [], res.data.message)] });
            } catch (e) { 
                await interaction.reply({ embeds: [createEmbed('❌ Erreur', 'Impossible de récupérer une image.', '#DC2626')], ephemeral: true }); 
            }
        }

        if (interaction.commandName === 'matricule') {
            const numero = interaction.options.getString('numero');
            const parts = interaction.member.displayName.split(' | ');
            const baseName = parts.length > 1 ? parts.slice(1).join(' | ') : interaction.member.displayName;
            const newName = `${numero} | ${baseName}`;
            if (newName.length > 32) {
                return interaction.reply({ embeds: [createEmbed('❌ Erreur', 'Le nom dépasse 32 caractères.', '#DC2626')], ephemeral: true });
            }
            try {
                await interaction.member.setNickname(newName);
                await interaction.reply({ embeds: [createEmbed('✅ Succès', `Nom mis à jour : **${newName}**`, '#059669')], ephemeral: true });
            } catch (error) { 
                await interaction.reply({ embeds: [createEmbed('❌ Erreur', 'Permission insuffisante.', '#DC2626')], ephemeral: true }); 
            }
        }

        if (interaction.commandName === 'test') {
            const guild = interaction.guild;
            const owner = await guild.fetchOwner();
            const embed = createEmbed(`📊 Statistiques du Serveur`, `Aperçu en temps réel de **${guild.name}**.`, '#003DA5', [
                { name: '👥 Membres', value: `**${guild.memberCount}** membres\n🟢 **${guild.members.cache.filter(m => !m.user.bot && m.presence?.status !== 'offline').size}** en ligne`, inline: true },
                { name: '📂 Catégories', value: `**${guild.channels.cache.filter(ch => ch.type === ChannelType.GuildCategory).size}**`, inline: true },
                { name: '💬 Salons', value: `**${guild.channels.cache.size}** au total`, inline: true },
                { name: '🎭 Rôles', value: `**${guild.roles.cache.size}** rôles`, inline: true },
                { name: '😊 Emojis', value: `**${guild.emojis.cache.size}** personnalisés`, inline: true },
                { name: '💎 Boosts', value: `**Niveau ${guild.premiumTier}**\n**${guild.premiumSubscriptionCount || 0}** boosts`, inline: true },
                { name: '👑 Propriétaire', value: `${owner.user}`, inline: true },
                { name: '📅 Création', value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:D>\n<t:${Math.floor(guild.createdTimestamp / 1000)}:R>`, inline: false }
            ], guild.iconURL({ size: 4096, dynamic: true }));

            const row1 = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder().setCustomId('test_stats').setLabel('📊 Stats').setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId('test_members').setLabel('👥 Membres').setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId('test_invite').setLabel('🔗 Invitation').setStyle(ButtonStyle.Success)
                );
            const row2 = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder().setCustomId('test_info').setLabel('ℹ️ Infos').setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId('test_close').setLabel('❌ Fermer').setStyle(ButtonStyle.Danger)
                );
            await interaction.reply({ embeds: [embed], components: [row1, row2] });
        }

        if (interaction.commandName === 'ticket') {
            const existingTicket = interaction.guild.channels.cache.find(c => c.name === `ticket-${interaction.user.username}`);
            if (existingTicket) {
                return interaction.reply({ embeds: [createEmbed('❌ Erreur', 'Tu as déjà un ticket ouvert.', '#DC2626')], ephemeral: true });
            }
            const ticketChannel = await interaction.guild.channels.create({ name: `ticket-${interaction.user.username}`, type: ChannelType.GuildText, topic: `Ticket de ${interaction.user.tag}`, permissionOverwrites: [{ id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] }, { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }, { id: interaction.guild.roles.cache.find(r => r.permissions.has(PermissionFlagsBits.ManageChannels))?.id || interaction.guild.ownerId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }] });
            await sendLog('🎫 Ticket Créé', `**${interaction.user.tag}** a ouvert un ticket : <#${ticketChannel.id}>`, '#4d8dff', [], interaction.user.displayAvatarURL({ size: 256 }));
            await ticketChannel.send({ content: `${interaction.user}`, embeds: [createEmbed('🎫 Nouveau Ticket', `Bonjour ${interaction.user},\n\nUn membre du staff va prendre en charge ta demande.\n\n**Veuillez décrire ton problème ci-dessous.**`, '#003DA5')] });
            await interaction.reply({ embeds: [createEmbed('✅ Succès', `Ticket créé : ${ticketChannel}`, '#059669')], ephemeral: true });
        }

        if (interaction.commandName === 'close') {
            if (!interaction.channel.name.startsWith('ticket-')) {
                return interaction.reply({ embeds: [createEmbed('❌ Erreur', 'Cette commande ne fonctionne que dans un ticket.', '#DC2626')], ephemeral: true });
            }
            await interaction.reply({ embeds: [createEmbed('⏳ Fermeture en cours', 'Le ticket sera fermé dans 5 secondes...', '#D97706')], ephemeral: true });
            setTimeout(async () => { 
                await sendLog('🔒 Ticket Fermé', `Le ticket **${interaction.channel.name}** a été fermé par **${interaction.user.tag}**.`, '#D97706', [], interaction.user.displayAvatarURL({ size: 256 }));
                await interaction.channel.delete(); 
            }, 5000);
        }

        if (interaction.commandName === 'warn') {
            const target = interaction.options.getUser('membre');
            const reason = interaction.options.getString('raison');
            const warnCount = addWarn(target.id);
            const embed = createEmbed('⚠️ Avertissement Officiel', `Tu as reçu un avertissement.\n**Nombre d'avertissements :** ${warnCount}`, '#D97706', [
                { name: 'Modérateur', value: interaction.user.tag, inline: true },
                { name: 'Raison', value: reason, inline: false }
            ]);
            await sendModLog('Avertissement', target, interaction.user, reason, '#D97706');
            try { await target.send({ embeds: [embed] }); } catch (e) {}
            await interaction.reply({ embeds: [createEmbed('✅ Succès', `${target.tag} a été averti. (Total: ${warnCount})`, '#059669')], ephemeral: true });
        }

        if (interaction.commandName === 'clear') {
            const amount = interaction.options.getInteger('nombre');
            await interaction.channel.bulkDelete(amount, true);
            await sendLog('🧹 Messages Supprimés', `**${interaction.user.tag}** a supprimé **${amount}** messages.`, '#D97706', [], interaction.user.displayAvatarURL({ size: 256 }));
            const msg = await interaction.reply({ embeds: [createEmbed('✅ Nettoyage', `${amount} messages supprimés.`, '#059669')], ephemeral: true, fetchReply: true });
            setTimeout(async () => { if (msg.deletable) await msg.delete(); }, 3000);
        }

        if (interaction.commandName === 'userinfo') {
            const member = interaction.options.getMember('membre') || interaction.member;
            const roles = member.roles.cache.filter(r => r.id !== member.guild.id).map(r => r.name).join(', ') || 'Aucun';
            await interaction.reply({ embeds: [createEmbed(`👤 Informations Utilisateur`, `Détails de **${member.user.username}**.`, '#003DA5', [
                { name: '🏷️ Pseudo', value: member.displayName, inline: true },
                { name: '🆔 Identifiant', value: member.id, inline: true },
                { name: '📅 Compte créé', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:D>`, inline: true },
                { name: '🚪 A rejoint le', value: member.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:D>` : 'Inconnu', inline: true },
                { name: '🎭 Rôles', value: roles.substring(0, 1000), inline: false }
            ], member.user.displayAvatarURL({ size: 4096, dynamic: true }))] });
        }

        if (interaction.commandName === 'serverinfo') {
            const guild = interaction.guild;
            const owner = await guild.fetchOwner();
            await interaction.reply({ embeds: [createEmbed(`📊 Informations du Serveur`, `Détails de **${guild.name}**.`, '#003DA5', [
                { name: '👑 Propriétaire', value: `${owner.user}`, inline: true },
                { name: '🆔 Identifiant', value: guild.id, inline: true },
                { name: '👥 Membres', value: `${guild.memberCount} membres`, inline: true },
                { name: '📂 Catégories', value: `${guild.channels.cache.filter(c => c.type === ChannelType.GuildCategory).size}`, inline: true },
                { name: '💬 Salons', value: `${guild.channels.cache.size} au total`, inline: true },
                { name: '🎭 Rôles', value: `${guild.roles.cache.size}`, inline: true },
                { name: '📅 Création', value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:D>`, inline: false }
            ], guild.iconURL({ size: 4096, dynamic: true }))] });
        }

        // ==========================================
        // COMMANDE SCAN (5 FICHIERS ÉQUILIBRÉS)
        // ==========================================
        if (interaction.commandName === 'scan') {
            if (interaction.user.id !== JACOBIN_ID) {
                return interaction.reply({ embeds: [createEmbed('❌ Accès Refusé', 'Réservé à Jacobin904.', '#DC2626')], ephemeral: true });
            }
            await interaction.deferReply({ ephemeral: true });
            try {
                const guild = interaction.guild;
                const items = [];
                
                // Collecte des données
                items.push({ _type: 'server_info', id: guild.id, name: guild.name, memberCount: guild.memberCount, ownerId: guild.ownerId });
                guild.channels.cache.forEach(ch => items.push({ _type: 'channel', id: ch.id, name: ch.name, type: ChannelType[ch.type] }));
                guild.roles.cache.forEach(role => items.push({ _type: 'role', id: role.id, name: role.name, color: role.hexColor }));
                guild.members.cache.forEach(member => items.push({ _type: 'member', id: member.id, username: member.user.username, displayName: member.displayName }));
                
                // Algorithme de répartition équilibrée (Bin Packing)
                items.sort((a, b) => JSON.stringify(b).length - JSON.stringify(a).length);
                const buckets = Array.from({ length: 5 }, () => ({ items: [], size: 0 }));
                
                for (const item of items) {
                    const itemSize = JSON.stringify(item).length;
                    // Trouve le seau (fichier) le plus léger actuellement
                    const smallestBucket = buckets.reduce((prev, curr) => prev.size < curr.size ? prev : curr);
                    smallestBucket.items.push(item);
                    smallestBucket.size += itemSize;
                }

                const files = [];
                const timestamp = Date.now();
                const safeName = guild.name.replace(/\s+/g, '_');
                
                // Génération des 5 fichiers
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
                        name: `scan_part_${String(i + 1).padStart(2, '0')}_${safeName}_${timestamp}.json` 
                    });
                }
                
                await interaction.followUp({ 
                    embeds: [createEmbed('✅ Scan Terminé', 'Le scan complet du serveur a été généré en **5 fichiers JSON de taille équilibrée**.', '#059669')], 
                    files: files, 
                    ephemeral: true 
                });
            } catch (error) {
                await interaction.followUp({ embeds: [createEmbed('❌ Erreur', `\`\`\`js\n${error.message}\n\`\`\``, '#DC2626')], ephemeral: true });
            }
        }

        if (interaction.commandName === 'rank') {
            const member = interaction.options.getMember('membre') || interaction.member;
            const data = getXP(member.id);
            await interaction.reply({ embeds: [createEmbed(`📊 Rang de ${member.user.username}`, `**Niveau :** ${data.level}\n**XP :** ${data.xp}/${data.level * 100}`, '#003DA5', [], member.user.displayAvatarURL({ size: 256 }))] });
        }

        if (interaction.commandName === 'leaderboard') {
            const sorted = Array.from(db.levels.entries()).sort((a, b) => b[1].level - a[1].level).slice(0, 10);
            const desc = sorted.map(([userId, data], i) => `**${i + 1}.** <@${userId}> - Niveau ${data.level}`).join('\n') || 'Aucune donnée.';
            await interaction.reply({ embeds: [createEmbed('🏆 Classement XP', desc, '#003DA5')] });
        }

        if (interaction.commandName === 'balance') {
            const member = interaction.options.getMember('membre') || interaction.member;
            const data = getEconomy(member.id);
            await interaction.reply({ embeds: [createEmbed(`💰 Solde de ${member.user.username}`, `**Coins :** ${data.coins}\n**Banque :** ${data.bank}`, '#003DA5', [], member.user.displayAvatarURL({ size: 256 }))] });
        }

        if (interaction.commandName === 'daily') {
            const data = getEconomy(interaction.user.id);
            const lastDaily = db.economy.get(`${interaction.user.id}_lastDaily`);
            const now = Date.now();
            if (lastDaily && now - lastDaily < 86400000) {
                const remaining = Math.ceil((86400000 - (now - lastDaily)) / 3600000);
                return interaction.reply({ embeds: [createEmbed('❌ Erreur', `Reviens dans **${remaining} heure(s)**.`, '#DC2626')], ephemeral: true });
            }
            const reward = Math.floor(Math.random() * 100) + 50;
            data.coins += reward;
            db.economy.set(`${interaction.user.id}_lastDaily`, now);
            await interaction.reply({ embeds: [createEmbed('🎁 Récompense Quotidienne', `Tu as reçu **${reward} coins** !`, '#059669')] });
        }

        if (interaction.commandName === 'give') {
            const target = interaction.options.getUser('utilisateur');
            const amount = interaction.options.getInteger('montant');
            const senderData = getEconomy(interaction.user.id);
            if (senderData.coins < amount) {
                return interaction.reply({ embeds: [createEmbed('❌ Erreur', 'Tu n\'as pas assez de coins.', '#DC2626')], ephemeral: true });
            }
            senderData.coins -= amount;
            const targetData = getEconomy(target.id);
            targetData.coins += amount;
            await interaction.reply({ embeds: [createEmbed('✅ Transfert', `Tu as donné **${amount} coins** à ${target}.`, '#059669')] });
        }

        if (interaction.commandName === 'kick') {
            const target = interaction.options.getMember('membre');
            const reason = interaction.options.getString('raison') || 'Aucune raison';
            await target.kick(reason);
            await sendModLog('Expulsion', target, interaction.user, reason, '#D97706');
            await interaction.reply({ embeds: [createEmbed('✅ Succès', `${target.user.tag} a été expulsé.`, '#059669')] });
        }

        if (interaction.commandName === 'ban') {
            const target = interaction.options.getMember('membre');
            const reason = interaction.options.getString('raison') || 'Aucune raison';
            await target.ban({ reason });
            await sendModLog('Bannissement', target, interaction.user, reason, '#DC2626');
            await interaction.reply({ embeds: [createEmbed('✅ Succès', `${target.user.tag} a été banni.`, '#059669')] });
        }

        if (interaction.commandName === 'unban') {
            const userId = interaction.options.getString('userid');
            await interaction.guild.bans.remove(userId);
            await sendModLog('Débannissement', { tag: userId }, interaction.user, 'Débanni', '#059669');
            await interaction.reply({ embeds: [createEmbed('✅ Succès', `${userId} a été débanni.`, '#059669')] });
        }

        if (interaction.commandName === 'mute') {
            const target = interaction.options.getMember('membre');
            const duration = interaction.options.getInteger('durée');
            await target.timeout(duration * 60 * 1000);
            await sendModLog('Mute', target, interaction.user, `${duration} minutes`, '#D97706');
            await interaction.reply({ embeds: [createEmbed('✅ Succès', `${target.user.tag} est muet pour ${duration} minutes.`, '#059669')] });
        }

        if (interaction.commandName === 'unmute') {
            const target = interaction.options.getMember('membre');
            await target.timeout(null);
            await sendModLog('Unmute', target, interaction.user, 'Mute retiré', '#059669');
            await interaction.reply({ embeds: [createEmbed('✅ Succès', `Le mute de ${target.user.tag} a été retiré.`, '#059669')] });
        }

        if (interaction.commandName === 'giveaway') {
            const prize = interaction.options.getString('prix');
            const duration = interaction.options.getInteger('durée');
            const winners = interaction.options.getInteger('gagnants');
            const embed = createEmbed('🎉 GIVEAWAY', `**Prix :** ${prize}\n**Durée :** ${duration} minutes\n**Gagnants :** ${winners}\n\nRéagis avec 🎉 pour participer !`, '#FFD700');
            const message = await interaction.channel.send({ embeds: [embed] });
            await message.react('🎉');
            db.giveaways.set(message.id, { prize, duration, winners, endsAt: Date.now() + duration * 60 * 1000 });
            setTimeout(async () => {
                const giveaway = db.giveaways.get(message.id);
                if (!giveaway) return;
                const reacted = (await message.reactions.cache.get('🎉')?.fetch())?.users.cache.filter(u => !u.bot);
                if (!reacted || reacted.size === 0) {
                    await interaction.channel.send({ embeds: [createEmbed('🎉 Giveaway Terminé', 'Aucun participant.', '#DC2626')] });
                } else {
                    const winnerList = reacted.random(Math.min(winners, reacted.size));
                    await interaction.channel.send({ embeds: [createEmbed('🎉 Giveaway Terminé', `**Prix :** ${giveaway.prize}\n**Gagnant(s) :** ${winnerList.map(u => `<@${u.id}>`).join(', ')}`, '#FFD700')] });
                }
                db.giveaways.delete(message.id);
            }, duration * 60 * 1000);
            await interaction.reply({ embeds: [createEmbed('✅ Giveaway Créé', `Giveaway pour **${prize}** lancé !`, '#059669')], ephemeral: true });
        }

        if (interaction.commandName === 'tag') {
            const name = interaction.options.getString('nom');
            if (db.tags.has(name)) {
                await interaction.reply({ embeds: [createEmbed(`🏷️ Tag : ${name}`, db.tags.get(name), '#003DA5')] });
            } else {
                await interaction.reply({ embeds: [createEmbed('❌ Erreur', 'Ce tag n\'existe pas.', '#DC2626')], ephemeral: true });
            }
        }

        if (interaction.commandName === 'tagadd') {
            const name = interaction.options.getString('nom');
            const content = interaction.options.getString('contenu');
            db.tags.set(name, content);
            await interaction.reply({ embeds: [createEmbed('✅ Tag Créé', `Le tag **${name}** a été créé.`, '#059669')], ephemeral: true });
        }

        if (interaction.commandName === 'tagdelete') {
            const name = interaction.options.getString('nom');
            if (db.tags.has(name)) {
                db.tags.delete(name);
                await interaction.reply({ embeds: [createEmbed('✅ Tag Supprimé', `Le tag **${name}** a été supprimé.`, '#059669')], ephemeral: true });
            } else {
                await interaction.reply({ embeds: [createEmbed('❌ Erreur', 'Ce tag n\'existe pas.', '#DC2626')], ephemeral: true });
            }
        }

        if (interaction.commandName === 'ccadd') {
            const name = interaction.options.getString('nom');
            const response = interaction.options.getString('réponse');
            db.customCommands.set(name, { response });
            await interaction.reply({ embeds: [createEmbed('✅ Commande Custom Créée', `**!${name}** a été créée.`, '#059669')], ephemeral: true });
        }

        if (interaction.commandName === 'ccdelete') {
            const name = interaction.options.getString('nom');
            if (db.customCommands.has(name)) {
                db.customCommands.delete(name);
                await interaction.reply({ embeds: [createEmbed('✅ Commande Supprimée', `**!${name}** a été supprimée.`, '#059669')], ephemeral: true });
            } else {
                await interaction.reply({ embeds: [createEmbed('❌ Erreur', 'Cette commande n\'existe pas.', '#DC2626')], ephemeral: true });
            }
        }

        if (interaction.commandName === 'aradd') {
            const trigger = interaction.options.getString('déclencheur');
            const response = interaction.options.getString('réponse');
            db.autoresponders.set(trigger, response);
            await interaction.reply({ embeds: [createEmbed('✅ Auto-responder Créé', `Le déclencheur **${trigger}** a été ajouté.`, '#059669')], ephemeral: true });
        }

        if (interaction.commandName === 'ardelete') {
            const trigger = interaction.options.getString('déclencheur');
            if (db.autoresponders.has(trigger)) {
                db.autoresponders.delete(trigger);
                await interaction.reply({ embeds: [createEmbed('✅ Auto-responder Supprimé', `Le déclencheur **${trigger}** a été retiré.`, '#059669')], ephemeral: true });
            } else {
                await interaction.reply({ embeds: [createEmbed('❌ Erreur', 'Ce déclencheur n\'existe pas.', '#DC2626')], ephemeral: true });
            }
        }

        if (interaction.commandName === 'rradd') {
            const messageId = interaction.options.getString('messageid');
            const emoji = interaction.options.getString('emoji');
            const role = interaction.options.getRole('role');
            db.reactionRoles.set(`${messageId}_${emoji}`, role.id);
            await interaction.reply({ embeds: [createEmbed('✅ Reaction Role Ajouté', `Réagis avec ${emoji} pour obtenir **${role.name}**.`, '#059669')], ephemeral: true });
        }

        if (interaction.commandName === 'starboard') {
            const channel = interaction.options.getChannel('salon');
            const threshold = interaction.options.getInteger('seuil');
            db.starboard.set(interaction.channel.id, { channel: channel.id, emoji: '⭐', threshold });
            await interaction.reply({ embeds: [createEmbed('✅ Starboard Configuré', `Les messages avec **${threshold}** réactions ⭐ seront envoyés dans ${channel}.`, '#059669')], ephemeral: true });
        }

        if (interaction.commandName === 'slowmode') {
            const seconds = interaction.options.getInteger('secondes');
            await interaction.channel.setRateLimitPerUser(seconds);
            db.slowmode.set(interaction.channel.id, seconds);
            await interaction.reply({ embeds: [createEmbed('✅ Slowmode Défini', `Slowmode de **${seconds} secondes** activé.`, '#059669')], ephemeral: true });
        }

        if (interaction.commandName === 'autodelete') {
            const seconds = interaction.options.getInteger('secondes');
            if (seconds === 0) {
                db.autoDelete.delete(interaction.channel.id);
                await interaction.reply({ embeds: [createEmbed('✅ Auto Delete Désactivé', 'La suppression automatique est désactivée.', '#059669')], ephemeral: true });
            } else {
                db.autoDelete.set(interaction.channel.id, seconds);
                await interaction.reply({ embeds: [createEmbed('✅ Auto Delete Activé', `Les messages seront supprimés après **${seconds} secondes**.`, '#059669')], ephemeral: true });
            }
        }

        if (interaction.commandName === 'highlight') {
            const sub = interaction.options.getSubcommand();
            if (sub === 'add') {
                const mot = interaction.options.getString('mot');
                if (!db.highlights.has(interaction.user.id)) db.highlights.set(interaction.user.id, []);
                db.highlights.get(interaction.user.id).push(mot);
                await interaction.reply({ embeds: [createEmbed('✅ Mot-clé Ajouté', `Tu seras notifié pour **${mot}**.`, '#059669')], ephemeral: true });
            }
            if (sub === 'remove') {
                const mot = interaction.options.getString('mot');
                const keywords = db.highlights.get(interaction.user.id) || [];
                db.highlights.set(interaction.user.id, keywords.filter(k => k !== mot));
                await interaction.reply({ embeds: [createEmbed('✅ Mot-clé Retiré', `Le mot **${mot}** a été retiré.`, '#059669')], ephemeral: true });
            }
            if (sub === 'list') {
                const keywords = db.highlights.get(interaction.user.id) || [];
                await interaction.reply({ embeds: [createEmbed('📋 Tes Mots-clés', keywords.length > 0 ? keywords.join(', ') : 'Aucun mot-clé.', '#003DA5')], ephemeral: true });
            }
        }

        if (interaction.commandName === 'form') {
            const titre = interaction.options.getString('titre');
            const channel = interaction.options.getChannel('salon');
            const embed = createEmbed(`📝 Formulaire : ${titre}`, 'Clique sur le bouton pour remplir le formulaire.', '#003DA5');
            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`form_${titre}`).setLabel('Remplir le formulaire').setStyle(ButtonStyle.Primary));
            await channel.send({ embeds: [embed], components: [row] });
            db.forms.set(titre, { channel: channel.id });
            await interaction.reply({ embeds: [createEmbed('✅ Formulaire Créé', `Le formulaire **${titre}** a été envoyé dans ${channel}.`, '#059669')], ephemeral: true });
        }

        if (interaction.commandName === 'welcome') {
            const channel = interaction.options.getChannel('salon');
            const message = interaction.options.getString('message');
            db.welcome = { enabled: true, channel: channel.id, message };
            await interaction.reply({ embeds: [createEmbed('✅ Bienvenue Configuré', `Le message de bienvenue sera envoyé dans ${channel}.`, '#059669')], ephemeral: true });
        }

        if (interaction.commandName === 'autorole') {
            const role = interaction.options.getRole('role');
            if (!db.autoroles.has('join')) db.autoroles.set('join', []);
            db.autoroles.get('join').push(role.id);
            await interaction.reply({ embeds: [createEmbed('✅ Autorole Ajouté', `Le rôle **${role.name}** sera ajouté aux nouveaux membres.`, '#059669')], ephemeral: true });
        }

        if (interaction.commandName === 'automod') {
            const sub = interaction.options.getSubcommand();
            if (sub === 'addword') {
                const mot = interaction.options.getString('mot');
                db.automod.badWords.push(mot);
                await interaction.reply({ embeds: [createEmbed('✅ Mot Interdit Ajouté', `Le mot **${mot}** est maintenant interdit.`, '#059669')], ephemeral: true });
            }
            if (sub === 'removeword') {
                const mot = interaction.options.getString('mot');
                db.automod.badWords = db.automod.badWords.filter(w => w !== mot);
                await interaction.reply({ embeds: [createEmbed('✅ Mot Interdit Retiré', `Le mot **${mot}** n'est plus interdit.`, '#059669')], ephemeral: true });
            }
        }

        if (interaction.commandName === 'modlog') {
            const channel = interaction.options.getChannel('salon');
            db.modlogs = { enabled: true, channel: channel.id };
            await interaction.reply({ embeds: [createEmbed('✅ Modlog Configuré', `Les logs de modération seront envoyés dans ${channel}.`, '#059669')], ephemeral: true });
        }

        if (interaction.commandName === 'serverlog') {
            const channel = interaction.options.getChannel('salon');
            db.serverlogs = { enabled: true, channel: channel.id };
            await interaction.reply({ embeds: [createEmbed('✅ Serverlog Configuré', `Les logs du serveur seront envoyés dans ${channel}.`, '#059669')], ephemeral: true });
        }

        if (interaction.commandName === 'warnings') {
            const user = interaction.options.getUser('utilisateur') || interaction.user;
            const count = getWarnCount(user.id);
            await interaction.reply({ embeds: [createEmbed(`⚠️ Avertissements de ${user.username}`, `**Nombre d'avertissements :** ${count}`, '#D97706', [], user.displayAvatarURL({ size: 256 }))] });
        }

        if (interaction.commandName === 'selfrole') {
            const role = interaction.options.getRole('role');
            db.selfroles.set(role.id, role.name);
            await interaction.reply({ embeds: [createEmbed('✅ Self-role Ajouté', `Le rôle **${role.name}** est maintenant disponible en self-role.`, '#059669')], ephemeral: true });
        }

        if (interaction.commandName === 'counting') {
            const channel = interaction.options.getChannel('salon');
            db.counting = { enabled: true, channel: channel.id, current: 0, lastUser: null };
            await interaction.reply({ embeds: [createEmbed('✅ Counting Configuré', `Le counting est activé dans ${channel}.`, '#059669')], ephemeral: true });
        }

        if (interaction.commandName === 'trivia') {
            const channel = interaction.options.getChannel('salon');
            db.trivia = { enabled: true, channel: channel.id, score: new Map() };
            await interaction.reply({ embeds: [createEmbed('✅ Trivia Configuré', `Le trivia est activé dans ${channel}.`, '#059669')], ephemeral: true });
        }

        const voiceCommands = ['lockvc', 'unlockvc', 'hidevc', 'showvc', 'limitvc', 'renamevc', 'kickvc', 'banvc', 'unbanvc', 'claimvc', 'vcinfo'];
        if (voiceCommands.includes(interaction.commandName)) {
            const member = interaction.member;
            const voiceChannel = member.voice.channel;
            if (!voiceChannel) {
                return interaction.reply({ embeds: [createEmbed('❌ Erreur', 'Tu dois être dans un salon vocal.', '#DC2626')], ephemeral: true });
            }
            if (interaction.commandName !== 'claimvc' && !isVoiceOwner(member, voiceChannel)) {
                return interaction.reply({ embeds: [createEmbed('❌ Erreur', 'Tu n\'es pas le propriétaire.', '#DC2626')], ephemeral: true });
            }
            
            if (interaction.commandName === 'lockvc') { 
                await voiceChannel.permissionOverwrites.edit(interaction.guild.id, { Connect: false }); 
                await sendLog('🔒 Vocal Verrouillé', `**${member.user.tag}** a verrouillé <#${voiceChannel.id}>.`, '#D97706', [], member.user.displayAvatarURL({ size: 256 }));
                await interaction.reply({ embeds: [createEmbed('🔒 Succès', 'Salon verrouillé.', '#059669')], ephemeral: true }); 
            }
            if (interaction.commandName === 'unlockvc') { 
                await voiceChannel.permissionOverwrites.edit(interaction.guild.id, { Connect: null }); 
                await sendLog('🔓 Vocal Déverrouillé', `**${member.user.tag}** a déverrouillé <#${voiceChannel.id}>.`, '#059669', [], member.user.displayAvatarURL({ size: 256 }));
                await interaction.reply({ embeds: [createEmbed('🔓 Succès', 'Salon déverrouillé.', '#059669')], ephemeral: true }); 
            }
            if (interaction.commandName === 'hidevc') { 
                await voiceChannel.permissionOverwrites.edit(interaction.guild.id, { ViewChannel: false }); 
                await sendLog('👻 Vocal Masqué', `**${member.user.tag}** a masqué <#${voiceChannel.id}>.`, '#D97706', [], member.user.displayAvatarURL({ size: 256 }));
                await interaction.reply({ embeds: [createEmbed('👻 Succès', 'Salon masqué.', '#059669')], ephemeral: true }); 
            }
            if (interaction.commandName === 'showvc') { 
                await voiceChannel.permissionOverwrites.edit(interaction.guild.id, { ViewChannel: null }); 
                await sendLog('👁️ Vocal Visible', `**${member.user.tag}** a rendu visible <#${voiceChannel.id}>.`, '#059669', [], member.user.displayAvatarURL({ size: 256 }));
                await interaction.reply({ embeds: [createEmbed('👁️ Succès', 'Salon visible.', '#059669')], ephemeral: true }); 
            }
            if (interaction.commandName === 'limitvc') { 
                const limit = interaction.options.getInteger('limite'); 
                await voiceChannel.setUserLimit(limit); 
                await sendLog('👥 Limite Vocale', `**${member.user.tag}** a mis la limite à ${limit}.`, '#003DA5', [], member.user.displayAvatarURL({ size: 256 }));
                await interaction.reply({ embeds: [createEmbed('👥 Succès', `Limite : **${limit === 0 ? 'illimité' : limit}**.`, '#059669')], ephemeral: true }); 
            }
            if (interaction.commandName === 'renamevc') { 
                const nom = interaction.options.getString('nom'); 
                await voiceChannel.setName(nom); 
                await sendLog('✏️ Vocal Renommé', `**${member.user.tag}** a renommé en "${nom}".`, '#003DA5', [], member.user.displayAvatarURL({ size: 256 }));
                await interaction.reply({ embeds: [createEmbed('✏️ Succès', `Salon renommé en **${nom}**.`, '#059669')], ephemeral: true }); 
            }
            if (interaction.commandName === 'kickvc') { 
                const target = interaction.options.getMember('membre'); 
                if (!target.voice.channel || target.voice.channel.id !== voiceChannel.id) {
                    return interaction.reply({ embeds: [createEmbed('❌ Erreur', 'Ce membre n\'est pas dans ton salon.', '#DC2626')], ephemeral: true });
                }
                await target.voice.disconnect(); 
                await sendLog('👢 Kick Vocal', `**${member.user.tag}** a kick **${target.user.tag}**.`, '#D97706', [], member.user.displayAvatarURL({ size: 256 }));
                await interaction.reply({ embeds: [createEmbed('👢 Succès', `${target.user.tag} a été expulsé.`, '#059669')], ephemeral: true }); 
            }
            if (interaction.commandName === 'banvc') { 
                const target = interaction.options.getMember('membre'); 
                if (!target.voice.channel || target.voice.channel.id !== voiceChannel.id) {
                    return interaction.reply({ embeds: [createEmbed('❌ Erreur', 'Ce membre n\'est pas dans ton salon.', '#DC2626')], ephemeral: true });
                }
                await voiceChannel.permissionOverwrites.edit(target.id, { Connect: false, ViewChannel: false }); 
                await target.voice.disconnect(); 
                await sendLog('🚫 Ban Vocal', `**${member.user.tag}** a banni **${target.user.tag}**.`, '#DC2626', [], member.user.displayAvatarURL({ size: 256 }));
                await interaction.reply({ embeds: [createEmbed('🚫 Succès', `${target.user.tag} a été banni.`, '#059669')], ephemeral: true }); 
            }
            if (interaction.commandName === 'unbanvc') { 
                const target = interaction.options.getMember('membre'); 
                await voiceChannel.permissionOverwrites.delete(target.id); 
                await sendLog('✅ Débannissement Vocal', `**${member.user.tag}** a débanni **${target.user.tag}**.`, '#059669', [], member.user.displayAvatarURL({ size: 256 }));
                await interaction.reply({ embeds: [createEmbed('✅ Succès', `${target.user.tag} a été débanni.`, '#059669')], ephemeral: true }); 
            }
            if (interaction.commandName === 'claimvc') {
                if (!client.tempVoiceChannels.has(voiceChannel.id)) {
                    return interaction.reply({ embeds: [createEmbed('❌ Erreur', 'Ce salon n\'est pas temporaire.', '#DC2626')], ephemeral: true });
                }
                if (voiceChannel.members.has(client.tempVoiceChannels.get(voiceChannel.id))) {
                    return interaction.reply({ embeds: [createEmbed('❌ Erreur', 'Le propriétaire est toujours là.', '#DC2626')], ephemeral: true });
                }
                client.tempVoiceChannels.set(voiceChannel.id, member.id);
                await sendLog('👑 Propriété Réclamée', `**${member.user.tag}** a réclamé <#${voiceChannel.id}>.`, '#003DA5', [], member.user.displayAvatarURL({ size: 256 }));
                await interaction.reply({ embeds: [createEmbed('👑 Succès', 'Tu es maintenant propriétaire.', '#059669')], ephemeral: true });
            }
            if (interaction.commandName === 'vcinfo') {
                const owner = client.tempVoiceChannels.get(voiceChannel.id);
                const ownerMember = owner ? interaction.guild.members.cache.get(owner) : null;
                await interaction.reply({ embeds: [createEmbed(`📊 Infos du Salon`, `Détails de **${voiceChannel.name}**.`, '#003DA5', [
                    { name: '🆔 Identifiant', value: voiceChannel.id, inline: true },
                    { name: '👑 Propriétaire', value: ownerMember ? ownerMember.user.tag : 'Aucun', inline: true },
                    { name: '👥 Membres', value: `${voiceChannel.members.size}`, inline: true },
                    { name: '🚪 Limite', value: voiceChannel.userLimit === 0 ? 'Illimité' : `${voiceChannel.userLimit}`, inline: true }
                ])], ephemeral: true });
            }
        }
    }

    if (interaction.isButton()) {
        if (interaction.customId === 'test_stats') {
            await interaction.reply({ embeds: [createEmbed('📊 Statistiques', 'Tu as consulté les stats.', '#003DA5')], ephemeral: true });
        }
        if (interaction.customId === 'test_members') {
            const guild = interaction.guild;
            const online = guild.members.cache.filter(m => !m.user.bot && m.presence?.status !== 'offline').size;
            await interaction.reply({ embeds: [createEmbed('👥 Membres', `**En ligne :** ${online}\n**Total :** ${guild.memberCount}`, '#003DA5')], ephemeral: true });
        }
        if (interaction.customId === 'test_invite') {
            try {
                const invite = await interaction.channel.createInvite({ maxAge: 0, maxUses: 0 });
                await interaction.reply({ embeds: [createEmbed('🔗 Invitation', `Lien : ${invite.url}`, '#003DA5')], ephemeral: true });
            } catch (e) {
                await interaction.reply({ embeds: [createEmbed('❌ Erreur', 'Impossible de créer une invitation.', '#DC2626')], ephemeral: true });
            }
        }
        if (interaction.customId === 'test_info') {
            await interaction.reply({ embeds: [createEmbed('ℹ️ Informations', '**Bot VQC**\nVersion: 3.0.0\nDéveloppeur: Jacobin Babouain', '#003DA5')], ephemeral: true });
        }
        if (interaction.customId === 'test_close') {
            await interaction.message.delete();
        }

        const embedData = client.pendingEmbeds.get(interaction.user.id);
        if (!embedData || interaction.user.id !== embedData.authorId) return;
        
        if (interaction.customId === 'edit_title') {
            const modal = new ModalBuilder().setCustomId('modal_title').setTitle('Modifier le titre');
            modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('title_input').setLabel('Titre').setStyle(TextInputStyle.Short).setMaxLength(256).setRequired(true)));
            await interaction.showModal(modal);
        }
        if (interaction.customId === 'edit_description') {
            const modal = new ModalBuilder().setCustomId('modal_description').setTitle('Modifier la description');
            modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('description_input').setLabel('Description').setStyle(TextInputStyle.Paragraph).setMaxLength(4000).setRequired(false)));
            await interaction.showModal(modal);
        }
        if (interaction.customId === 'edit_image') {
            const modal = new ModalBuilder().setCustomId('modal_image').setTitle('Modifier l\'image');
            modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('image_input').setLabel('URL de l\'image').setStyle(TextInputStyle.Short).setMaxLength(2048).setRequired(true)));
            await interaction.showModal(modal);
        }
        if (interaction.customId === 'add_button') {
            if (embedData.buttons.length >= 5) {
                return interaction.reply({ embeds: [createEmbed('❌ Limite', 'Maximum 5 boutons.', '#DC2626')], ephemeral: true });
            }
            const modal = new ModalBuilder().setCustomId('modal_add_button').setTitle('Ajouter un bouton');
            modal.addComponents(
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('button_label').setLabel('Texte').setStyle(TextInputStyle.Short).setMaxLength(80).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('button_emoji').setLabel('Emoji (optionnel)').setStyle(TextInputStyle.Short).setMaxLength(50).setRequired(false)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('button_url').setLabel('URL').setStyle(TextInputStyle.Short).setMaxLength(2048).setRequired(true))
            );
            await interaction.showModal(modal);
        }
        if (interaction.customId === 'remove_button') {
            if (embedData.buttons.length === 0) {
                return interaction.reply({ embeds: [createEmbed('❌ Erreur', 'Aucun bouton à retirer.', '#DC2626')], ephemeral: true });
            }
            embedData.buttons.pop();
            await updatePreview(interaction, embedData);
        }
        if (interaction.customId === 'send_embed') {
            const modal = new ModalBuilder().setCustomId('modal_send').setTitle('Envoyer l\'embed');
            modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('channel_input').setLabel('ID ou nom du salon').setStyle(TextInputStyle.Short).setMaxLength(100).setRequired(true)));
            await interaction.showModal(modal);
        }
        if (interaction.customId === 'cancel_embed') {
            client.pendingEmbeds.delete(interaction.user.id);
            await interaction.reply({ embeds: [createEmbed('❌ Annulé', 'Création annulée.', '#DC2626')], ephemeral: true });
            try { const message = await interaction.channel.messages.fetch(embedData.messageId); await message.delete(); } catch (e) {}
        }
    }

    if (interaction.isModalSubmit()) {
        const embedData = client.pendingEmbeds.get(interaction.user.id);
        if (!embedData) return;
        
        if (interaction.customId === 'modal_title') { embedData.embed.title = interaction.fields.getTextInputValue('title_input'); await updatePreview(interaction, embedData); }
        if (interaction.customId === 'modal_description') { embedData.embed.description = interaction.fields.getTextInputValue('description_input') || null; await updatePreview(interaction, embedData); }
        if (interaction.customId === 'modal_image') { embedData.embed.image = interaction.fields.getTextInputValue('image_input'); await updatePreview(interaction, embedData); }
        
        if (interaction.customId === 'modal_add_button') {
            const label = interaction.fields.getTextInputValue('button_label');
            const rawEmoji = interaction.fields.getTextInputValue('button_emoji').trim() || null;
            const url = interaction.fields.getTextInputValue('button_url');
            let resolvedEmoji = rawEmoji;
            if (rawEmoji && /^:\w+:$/.test(rawEmoji)) {
                const emojiName = rawEmoji.slice(1, -1).toLowerCase();
                const customEmoji = interaction.guild.emojis.cache.find(e => e.name.toLowerCase() === emojiName);
                if (customEmoji) resolvedEmoji = customEmoji.id;
                else resolvedEmoji = null;
            }
            embedData.buttons.push({ label, emoji: resolvedEmoji, url });
            await updatePreview(interaction, embedData);
        }
        
        if (interaction.customId === 'modal_send') {
            const channelInput = interaction.fields.getTextInputValue('channel_input');
            let targetChannel;
            if (channelInput.match(/^\d+$/)) targetChannel = await interaction.client.channels.fetch(channelInput).catch(() => null);
            else targetChannel = interaction.guild.channels.cache.find(c => c.name.toLowerCase() === channelInput.toLowerCase());
            if (!targetChannel || !targetChannel.isTextBased()) {
                return interaction.reply({ embeds: [createEmbed('❌ Erreur', 'Salon introuvable.', '#DC2626')], ephemeral: true });
            }
            const finalEmbed = new EmbedBuilder();
            if (embedData.embed.title) finalEmbed.setTitle(embedData.embed.title);
            if (embedData.embed.description) finalEmbed.setDescription(embedData.embed.description);
            if (embedData.embed.image) finalEmbed.setImage(embedData.embed.image);
            finalEmbed.setColor('#003DA5').setTimestamp();
            const components = [];
            if (embedData.buttons.length > 0) {
                const buttonRow = new ActionRowBuilder();
                embedData.buttons.forEach(btn => {
                    const button = new ButtonBuilder().setLabel(btn.label).setURL(btn.url).setStyle(ButtonStyle.Link);
                    if (btn.emoji) button.setEmoji(btn.emoji);
                    buttonRow.addComponents(button);
                });
                components.push(buttonRow);
            }
            await sendLog('📤 Embed Envoyé', `**${interaction.user.tag}** a envoyé un embed dans <#${targetChannel.id}>.`, '#059669', [], interaction.user.displayAvatarURL({ size: 256 }));
            await targetChannel.send({ embeds: [finalEmbed], components: components });
            client.pendingEmbeds.delete(interaction.user.id);
            await interaction.reply({ embeds: [createEmbed('✅ Succès', `Embed envoyé dans ${targetChannel}.`, '#059669')], ephemeral: true });
            try { const message = await interaction.channel.messages.fetch(embedData.messageId); await message.delete(); } catch (e) {}
        }
    }
});

function isVoiceOwner(member, channel) {
    if (!channel || !client.tempVoiceChannels.has(channel.id)) return false;
    return client.tempVoiceChannels.get(channel.id) === member.id;
}

async function updatePreview(interaction, embedData) {
    const previewEmbed = new EmbedBuilder();
    if (embedData.embed.title) previewEmbed.setTitle(embedData.embed.title);
    if (embedData.embed.description) previewEmbed.setDescription(embedData.embed.description);
    if (embedData.embed.image) previewEmbed.setImage(embedData.embed.image);
    previewEmbed.setColor('#003DA5').setTimestamp();
    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('edit_title').setLabel('Titre').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('edit_description').setLabel('Description').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('edit_image').setLabel('Image').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('add_button').setLabel('Ajouter Bouton').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('remove_button').setLabel('Retirer Bouton').setStyle(ButtonStyle.Secondary)
    );
    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('send_embed').setLabel('Envoyer').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('cancel_embed').setLabel('Annuler').setStyle(ButtonStyle.Danger)
    );
    const buttonRows = [];
    if (embedData.buttons.length > 0) {
        const btnRow = new ActionRowBuilder();
        embedData.buttons.forEach(btn => {
            const button = new ButtonBuilder().setLabel(btn.label).setURL(btn.url).setStyle(ButtonStyle.Link).setDisabled(true);
            if (btn.emoji) button.setEmoji(btn.emoji);
            btnRow.addComponents(button);
        });
        buttonRows.push(btnRow);
    }
    try {
        const message = await interaction.channel.messages.fetch(embedData.messageId);
        await message.edit({ embeds: [previewEmbed], components: [row1, ...buttonRows, row2] });
        await interaction.reply({ embeds: [createEmbed('✅ Mise à jour', `Prévisualisation mise à jour (${embedData.buttons.length} bouton(s)).`, '#059669')], ephemeral: true });
    } catch (e) { 
        await interaction.reply({ embeds: [createEmbed('❌ Erreur', 'Erreur lors de la mise à jour.', '#DC2626')], ephemeral: true }); 
    }
}

// ==========================================
// 11. BASE DE DONNÉES GITHUB (CANDIDATURES)
// ==========================================
app.post('/submit-application', async (req, res) => {
    try {
        const d = req.body;
        const githubToken = process.env.GITHUB_TOKEN;
        const repoOwner = "Jacobin904";
        const repoName = "Ville-de-Quebec-Roleplay";
        if (!githubToken) return res.status(500).json({ error: "Configuration serveur incomplete" });
        const issueBody = `
### 📋 Nouvelle Candidature Modérateur
**Date :** ${d.date}
**Roblox :** \`${d.roblox}\`
**Discord :** \`${d.discord}\`

---
**1. Pourquoi voulez-vous être modérateur ?**
${d.q1}

**2. Avez-vous déjà été modérateur auparavant ? Si oui, où ?**
${d.q2}

**3. Comment vous décririez-vous en tant que joueur ? (Min 2 phrases)**
${d.q3}

**4. Quelles sont les qualités les plus importantes d'un bon modérateur ? (Min 2 phrases)**
${d.q4}

**5. Gestion d'un modérateur qui enfreint les règles :**
${d.q5}

**6. Encourager les nouveaux membres :**
${d.q6}

**7. Comment amélioreriez-vous le serveur :**
${d.q7}

**8. Gestion d'une erreur personnelle :**
${d.q8}
        `.trim();
        await axios.post(`https://api.github.com/repos/${repoOwner}/${repoName}/issues`, {
            title: `📝 Candidature: ${d.roblox}`,
            body: issueBody,
            labels: ["candidature", "en-attente"]
        }, { headers: { 'Authorization': `token ${githubToken}`, 'Accept': 'application/vnd.github.v3+json' } });
        await sendLog('✅ Nouvelle Candidature', `**${d.roblox}** (${d.discord}) a soumis une candidature.`, '#059669');
        res.status(200).json({ success: true });
    } catch (error) {
        await sendLog('❌ Erreur Candidature', `Échec:\n\`\`\`js\n${error.message}\n\`\`\``, '#DC2626');
        res.status(500).json({ error: "Échec de l'enregistrement" });
    }
});

// ==========================================
// 12. CONNEXION
// ==========================================
if (!process.env.DISCORD_TOKEN) {
    console.error("[ERREUR CRITIQUE] DISCORD_TOKEN manquant !");
    process.exit(1);
}

client.login(process.env.DISCORD_TOKEN).catch(err => {
    console.error("[ERREUR CRITIQUE] Échec connexion Discord:", err.message);
    process.exit(1);
});

app.listen(PORT, HOST, () => {
    console.log(`[SERVEUR] Écoute active sur http://${HOST}:${PORT}`);
});
