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
    TextInputBuilder, TextInputStyle, PermissionsBitField
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

// ==========================================
// 2. FONCTIONS UTILITAIRES PROFESSIONNELLES
// ==========================================

/**
 * Crée un embed professionnel SANS grosse image en bas.
 * Utilise une miniature (en haut à droite) : soit l'avatar de l'utilisateur, soit le logo du serveur par défaut.
 * Le footer contient toujours le nom du serveur et son logo.
 */
function createEmbed(title, description, color = '#003DA5', fields = [], customThumbnail = null) {
    const embed = new EmbedBuilder()
        .setTitle(title)
        .setDescription(description)
        .setColor(color)
        .setFooter({ text: SERVER_NAME, iconURL: SERVER_ICON })
        .setTimestamp();

    // Miniature : PFP de l'utilisateur si fournie, sinon logo du serveur
    embed.setThumbnail(customThumbnail || SERVER_ICON);

    if (fields && fields.length > 0) embed.addFields(fields);
    
    return embed;
}

/**
 * Système de logs à triple sécurité (Canal -> Webhook -> Console)
 */
async function sendLog(title, description, color = '#003DA5', fields = [], customThumbnail = null) {
    const embed = createEmbed(title, description, color, fields, customThumbnail);
    
    // NIVEAU 1 : Canal Discord
    try {
        const channel = client.channels.cache.get(LOG_CHANNEL_ID);
        if (channel) {
            await channel.send({ embeds: [embed] });
            return;
        }
    } catch (err) { console.warn(`[LOG] Échec canal Discord: ${err.message}`); }

    // NIVEAU 2 : Webhook
    try {
        await axios.post(LOG_WEBHOOK_URL, { embeds: [embed.toJSON()] });
        return;
    } catch (err) { console.error(`[LOG] Échec Webhook: ${err.message}`); }

    // NIVEAU 3 : Console (Fallback ultime)
    console.error(`[LOG ULTIME] ${title} | ${description}`);
}

// ==========================================
// 3. INITIALISATION DU SERVEUR EXPRESS & CLIENT
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

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent, GatewayIntentBits.GuildModeration, GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessageReactions, GatewayIntentBits.GuildEmojisAndStickers, GatewayIntentBits.GuildPresences
    ] 
});

// Stockages temporaires
client.pendingEmbeds = new Map();
client.tempVoiceChannels = new Map();
client.afkUsers = new Map();
client.reminders = new Map();

// ==========================================
// 4. GESTION DES ERREURS GLOBALES
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
// 5. LOGS AUTOMATIQUES DU SERVEUR
// ==========================================
client.on('guildMemberAdd', async member => {
    await sendLog('📥 Nouveau Membre', `**${member.user.tag}** a rejoint le serveur.`, '#059669', [
        { name: 'Identifiant', value: member.id, inline: true },
        { name: 'Compte créé', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, inline: true },
        { name: 'Membres totaux', value: `${member.guild.memberCount}`, inline: true }
    ], member.user.displayAvatarURL({ size: 256, dynamic: true }));
});

client.on('guildMemberRemove', async member => {
    const roles = member.roles.cache.filter(r => r.id !== member.guild.id).map(r => r.name).join(', ') || 'Aucun';
    await sendLog('📤 Membre Parti', `**${member.user.tag}** a quitté le serveur.`, '#DC2626', [
        { name: 'Identifiant', value: member.id, inline: true },
        { name: 'A rejoint le', value: member.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>` : 'Inconnu', inline: true },
        { name: 'Derniers rôles', value: roles.substring(0, 1000), inline: false }
    ], member.user.displayAvatarURL({ size: 256, dynamic: true }));
});

client.on('guildMemberUpdate', async (oldMember, newMember) => {
    if (oldMember.nickname !== newMember.nickname) {
        await sendLog('✏️ Pseudo Modifié', `**${newMember.user.tag}** a changé de pseudo.`, '#D97706', [
            { name: 'Ancien', value: oldMember.nickname || 'Aucun', inline: true },
            { name: 'Nouveau', value: newMember.nickname || 'Aucun', inline: true }
        ], newMember.user.displayAvatarURL({ size: 256, dynamic: true }));
    }
    const added = newMember.roles.cache.filter(r => !oldMember.roles.cache.has(r.id));
    const removed = oldMember.roles.cache.filter(r => !newMember.roles.cache.has(r.id));
    if (added.size > 0) await sendLog('➕ Rôle Ajouté', `**${newMember.user.tag}** a reçu des rôles.`, '#D97706', [{ name: 'Rôles', value: added.map(r => r.name).join(', ') }], newMember.user.displayAvatarURL({ size: 256, dynamic: true }));
    if (removed.size > 0) await sendLog('➖ Rôle Retiré', `**${newMember.user.tag}** a perdu des rôles.`, '#D97706', [{ name: 'Rôles', value: removed.map(r => r.name).join(', ') }], newMember.user.displayAvatarURL({ size: 256, dynamic: true }));
    if (!oldMember.premiumSince && newMember.premiumSince) {
        await sendLog('💎 Nouveau Booster', `**${newMember.user.tag}** a boosté le serveur !`, '#D97706', [], newMember.user.displayAvatarURL({ size: 256, dynamic: true }));
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
            await sendLog('🎤 Vocal Temporaire Créé', `**${displayName}** a créé le salon <#${newChannel.id}>.`, '#059669', [], member.user.displayAvatarURL({ size: 256, dynamic: true }));
        } catch (error) { 
            await sendLog('❌ Erreur Vocal', `Échec de la création:\n\`\`\`js\n${error.message}\n\`\`\``, '#DC2626');
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
});

function isVoiceOwner(member, channel) {
    if (!channel || !client.tempVoiceChannels.has(channel.id)) return false;
    return client.tempVoiceChannels.get(channel.id) === member.id;
}

client.on('messageCreate', async message => {
    if (message.author.bot) return;
    if (message.mentions.users.size > 0) {
        for (const [userId, afkData] of client.afkUsers) {
            if (message.mentions.users.has(userId)) {
                await message.reply(`${afkData.username} est AFK : ${afkData.reason} (depuis <t:${Math.floor(afkData.timestamp / 1000)}:R>)`);
            }
        }
    }
    if (client.afkUsers.has(message.author.id)) {
        client.afkUsers.delete(message.author.id);
        await message.reply(`Bienvenue de retour ${message.author} ! Tu n'es plus AFK.`);
        if (message.member.displayName.startsWith('[AFK] ')) {
            await message.member.setNickname(message.member.displayName.replace('[AFK] ', '')).catch(() => {});
        }
    }
});

// ==========================================
// 6. API POUR LE SITE WEB
// ==========================================
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
// 7. ENREGISTREMENT DES COMMANDES
// ==========================================
const commands = [
    new SlashCommandBuilder().setName('ping').setDescription('Vérifie la latence du bot.'),
    new SlashCommandBuilder().setName('help').setDescription('Affiche la liste des commandes.'),
    new SlashCommandBuilder().setName('invite').setDescription('Obtenir le lien d\'invitation du bot.'),
    new SlashCommandBuilder().setName('avatar').setDescription('Voir l\'avatar d\'un utilisateur.').addUserOption(option => option.setName('utilisateur').setDescription('L\'utilisateur')),
    new SlashCommandBuilder().setName('banner').setDescription('Voir la bannière d\'un utilisateur.').addUserOption(option => option.setName('utilisateur').setDescription('L\'utilisateur')),
    new SlashCommandBuilder().setName('serverbanner').setDescription('Voir la bannière du serveur.'),
    new SlashCommandBuilder().setName('roleinfo').setDescription('Infos sur un rôle.').addRoleOption(option => option.setName('role').setDescription('Le rôle').setRequired(true)),
    new SlashCommandBuilder().setName('channelinfo').setDescription('Infos sur un salon.').addChannelOption(option => option.setName('salon').setDescription('Le salon')),
    new SlashCommandBuilder().setName('say').setDescription('Faire dire quelque chose au bot.').addStringOption(option => option.setName('message').setDescription('Le message').setRequired(true)),
    new SlashCommandBuilder().setName('announce').setDescription('Créer une annonce.').addStringOption(option => option.setName('titre').setDescription('Titre').setRequired(true)).addStringOption(option => option.setName('description').setDescription('Description').setRequired(true)).addChannelOption(option => option.setName('salon').setDescription('Salon de destination').setRequired(true)),
    new SlashCommandBuilder().setName('poll').setDescription('Créer un sondage.').addStringOption(option => option.setName('question').setDescription('La question').setRequired(true)).addStringOption(option => option.setName('options').setDescription('Options séparées par des virgules').setRequired(true)),
    new SlashCommandBuilder().setName('suggest').setDescription('Faire une suggestion.').addStringOption(option => option.setName('suggestion').setDescription('Ta suggestion').setRequired(true)),
    new SlashCommandBuilder().setName('8ball').setDescription('Pose une question à la boule magique.').addStringOption(option => option.setName('question').setDescription('Ta question').setRequired(true)),
    new SlashCommandBuilder().setName('coinflip').setDescription('Pile ou face.'),
    new SlashCommandBuilder().setName('dice').setDescription('Lancer un dé.'),
    new SlashCommandBuilder().setName('rps').setDescription('Pierre papier ciseaux.').addStringOption(option => option.setName('choix').setDescription('Pierre, papier ou ciseaux').setRequired(true).addChoices({ name: 'Pierre', value: 'pierre' }, { name: 'Papier', value: 'papier' }, { name: 'Ciseaux', value: 'ciseaux' })),
    new SlashCommandBuilder().setName('remind').setDescription('Définir un rappel.').addIntegerOption(option => option.setName('minutes').setDescription('Dans combien de minutes').setRequired(true)).addStringOption(option => option.setName('message').setDescription('Le rappel').setRequired(true)),
    new SlashCommandBuilder().setName('afk').setDescription('Définir ton statut AFK.').addStringOption(option => option.setName('raison').setDescription('Raison de ton AFK')),
    new SlashCommandBuilder().setName('meme').setDescription('Meme aléatoire.'),
    new SlashCommandBuilder().setName('cat').setDescription('Image de chat aléatoire.'),
    new SlashCommandBuilder().setName('dog').setDescription('Image de chien aléatoire.'),
    new SlashCommandBuilder().setName('embed').setDescription('Crée un embed interactif avec previsualisation.'),
    new SlashCommandBuilder().setName('ticket').setDescription('Ouvre un ticket de support.'),
    new SlashCommandBuilder().setName('close').setDescription('Ferme le ticket actuel.').setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
    new SlashCommandBuilder().setName('warn').setDescription('Avertir un membre.').setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers).addUserOption(option => option.setName('membre').setDescription('Le membre a avertir').setRequired(true)).addStringOption(option => option.setName('raison').setDescription('Raison de l\'avertissement').setRequired(true)),
    new SlashCommandBuilder().setName('clear').setDescription('Supprime des messages.').setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages).addIntegerOption(option => option.setName('nombre').setDescription('Nombre de messages a supprimer (max 100)').setRequired(true).setMinValue(1).setMaxValue(100)),
    new SlashCommandBuilder().setName('userinfo').setDescription('Affiche les informations d\'un utilisateur.').addUserOption(option => option.setName('membre').setDescription('Le membre dont voir les infos')),
    new SlashCommandBuilder().setName('serverinfo').setDescription('Affiche les informations du serveur.'),
    new SlashCommandBuilder().setName('matricule').setDescription('Définit ou met à jour votre matricule.').addStringOption(option => option.setName('numero').setDescription('Votre numéro de matricule (ex: 12-43)').setRequired(true)),
    new SlashCommandBuilder().setName('lockvc').setDescription('Verrouiller le salon vocal.'),
    new SlashCommandBuilder().setName('unlockvc').setDescription('Déverrouiller le salon vocal.'),
    new SlashCommandBuilder().setName('hidevc').setDescription('Cacher le salon vocal.'),
    new SlashCommandBuilder().setName('showvc').setDescription('Rendre le salon vocal visible.'),
    new SlashCommandBuilder().setName('limitvc').setDescription('Limiter le nombre de personnes dans le salon.').addIntegerOption(option => option.setName('limite').setDescription('Nombre maximum (0 = illimité)').setRequired(true).setMinValue(0).setMaxValue(99)),
    new SlashCommandBuilder().setName('renamevc').setDescription('Renommer le salon vocal.').addStringOption(option => option.setName('nom').setDescription('Nouveau nom du salon').setRequired(true)),
    new SlashCommandBuilder().setName('kickvc').setDescription('Kick quelqu\'un du salon vocal.').addUserOption(option => option.setName('membre').setDescription('Le membre a kick').setRequired(true)),
    new SlashCommandBuilder().setName('banvc').setDescription('Bannir quelqu\'un du salon vocal.').addUserOption(option => option.setName('membre').setDescription('Le membre a bannir').setRequired(true)),
    new SlashCommandBuilder().setName('unbanvc').setDescription('Débannir quelqu\'un du salon vocal.').addUserOption(option => option.setName('membre').setDescription('Le membre a débannir').setRequired(true)),
    new SlashCommandBuilder().setName('claimvc').setDescription('Réclamer la propriété du salon si le proprio a quitté.'),
    new SlashCommandBuilder().setName('vcinfo').setDescription('Voir les infos du salon vocal.'),
    new SlashCommandBuilder().setName('scan').setDescription('Scanner complet du serveur en 10 fichiers (Jacobin904 uniquement)'),
    new SlashCommandBuilder().setName('test').setDescription('Test embed avec boutons et stats du serveur')
];

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

client.once('clientReady', async () => {
    try {
        await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), { body: commands.map(cmd => cmd.toJSON()) });
        await sendLog('✅ Bot Démarré', `Le système est en ligne et opérationnel.\n**Identité :** ${client.user.tag}\n**Serveurs :** ${client.guilds.cache.size}\n**Membres totaux :** ${client.guilds.cache.reduce((acc, g) => acc + g.memberCount, 0)}`, '#059669', [], client.user.displayAvatarURL({ size: 256 }));
    } catch (error) {
        await sendLog('❌ Erreur Démarrage', `Échec de l'enregistrement des commandes:\n\`\`\`js\n${error.message}\n\`\`\``, '#DC2626');
    }
});

// ==========================================
// 8. GESTION DES INTERACTIONS
// ==========================================
client.on('interactionCreate', async interaction => {
    // --- COMMANDES SLASH ---
    if (interaction.isChatInputCommand()) {
        const options = interaction.options.data.map(o => `${o.name}: ${o.value}`).join('\n') || 'Aucune';
        await sendLog('⚡ Commande Utilisée', `**${interaction.user.tag}** a utilisé \`/${interaction.commandName}\`\nDans: <#${interaction.channel.id}>`, '#4d8dff', [{ name: 'Options', value: options }], interaction.user.displayAvatarURL({ size: 256, dynamic: true }));

        if (interaction.commandName === 'ping') {
            const embed = createEmbed('🏓 Pong !', `Latence actuelle : **${client.ws.ping}ms**`, '#003DA5');
            await interaction.reply({ embeds: [embed] });
        }
        
        if (interaction.commandName === 'help') {
            const embed = createEmbed('📖 Centre d\'aide - Commandes', 'Voici la liste complète des commandes disponibles sur le serveur.', '#003DA5', [
                { name: '🎤 Gestion Vocale', value: '`/lockvc` `/unlockvc` `/hidevc` `/showvc` `/limitvc` `/renamevc` `/kickvc` `/banvc` `/unbanvc` `/claimvc` `/vcinfo`', inline: false },
                { name: '🎮 Divertissement', value: '`/8ball` `/coinflip` `/dice` `/rps` `/meme` `/cat` `/dog`', inline: false },
                { name: '🔧 Utilitaires', value: '`/help` `/avatar` `/banner` `/roleinfo` `/channelinfo` `/invite` `/suggest` `/poll` `/say` `/announce` `/remind` `/afk`', inline: false },
                { name: '🛡️ Modération & Support', value: '`/warn` `/clear` `/ticket` `/close` `/embed` `/matricule`', inline: false }
            ]);
            await interaction.reply({ embeds: [embed], ephemeral: true });
        }

        if (interaction.commandName === 'invite') {
            const embed = createEmbed('🔗 Invitation', `[Clique ici pour inviter le bot sur ton serveur](https://discord.com/api/oauth2/authorize?client_id=${client.user.id}&permissions=8&scope=bot%20applications.commands)`, '#003DA5');
            await interaction.reply({ embeds: [embed] });
        }

        if (interaction.commandName === 'avatar') {
            const user = interaction.options.getUser('utilisateur') || interaction.user;
            // Ici, on remplace le logo du serveur par la PFP de l'utilisateur en miniature
            const embed = createEmbed(`Avatar de ${user.username}`, `Voici l'avatar de **${user.username}**.`, '#003DA5', [], user.displayAvatarURL({ size: 4096, dynamic: true }));
            await interaction.reply({ embeds: [embed] });
        }

        if (interaction.commandName === 'banner') {
            const user = interaction.options.getUser('utilisateur') || interaction.user;
            const fetchedUser = await client.users.fetch(user.id, { force: true });
            if (fetchedUser.banner) {
                // Exception : une bannière a besoin d'être grande pour être vue, donc on utilise setImage() uniquement ici
                const embed = createEmbed(`Bannière de ${user.username}`, `Voici la bannière de **${user.username}**.`, '#003DA5', [], user.displayAvatarURL({ size: 256, dynamic: true }));
                embed.setImage(fetchedUser.bannerURL({ size: 4096, dynamic: true }));
                await interaction.reply({ embeds: [embed] });
            } else {
                const embed = createEmbed('❌ Non trouvé', 'Cet utilisateur n\'a pas de bannière.', '#DC2626');
                await interaction.reply({ embeds: [embed], ephemeral: true });
            }
        }

        if (interaction.commandName === 'serverbanner') {
            const banner = interaction.guild.bannerURL({ size: 4096, dynamic: true });
            if (banner) {
                const embed = createEmbed(`Bannière de ${interaction.guild.name}`, `Voici la bannière officielle du serveur.`, '#003DA5');
                embed.setImage(banner);
                await interaction.reply({ embeds: [embed] });
            } else {
                const embed = createEmbed('❌ Non trouvé', 'Ce serveur n\'a pas de bannière.', '#DC2626');
                await interaction.reply({ embeds: [embed], ephemeral: true });
            }
        }

        if (interaction.commandName === 'roleinfo') {
            const role = interaction.options.getRole('role');
            const embed = createEmbed(`🎭 Rôle : ${role.name}`, `Détails du rôle **@${role.name}**.`, role.color || '#003DA5', [
                { name: '🆔 Identifiant', value: role.id, inline: true },
                { name: '📊 Position', value: `${role.position}`, inline: true },
                { name: '👥 Membres', value: `${role.members.size}`, inline: true }
            ]);
            await interaction.reply({ embeds: [embed] });
        }

        if (interaction.commandName === 'channelinfo') {
            const channel = interaction.options.getChannel('salon') || interaction.channel;
            const embed = createEmbed(`💬 Salon : ${channel.name}`, `Détails du salon **#${channel.name}**.`, '#003DA5', [
                { name: '🆔 Identifiant', value: channel.id, inline: true },
                { name: '📂 Type', value: ChannelType[channel.type], inline: true }
            ]);
            await interaction.reply({ embeds: [embed] });
        }

        if (interaction.commandName === 'say') {
            await interaction.channel.send(interaction.options.getString('message'));
            const embed = createEmbed('✅ Succès', 'Le message a été envoyé avec succès.', '#059669');
            await interaction.reply({ embeds: [embed], ephemeral: true });
        }

        if (interaction.commandName === 'announce') {
            const titre = interaction.options.getString('titre');
            const description = interaction.options.getString('description');
            const channel = interaction.options.getChannel('salon');
            const embed = createEmbed(titre, description, '#003DA5').setFooter({ text: `Annonce par ${interaction.user.username}`, iconURL: interaction.user.displayAvatarURL({ size: 256 }) });
            await channel.send({ embeds: [embed] });
            const replyEmbed = createEmbed('✅ Succès', `L'annonce a été envoyée dans ${channel}.`, '#059669');
            await interaction.reply({ embeds: [replyEmbed], ephemeral: true });
        }

        if (interaction.commandName === 'poll') {
            const question = interaction.options.getString('question');
            const options = interaction.options.getString('options').split(',').map(o => o.trim());
            if (options.length < 2 || options.length > 10) {
                const embed = createEmbed('❌ Erreur', 'Veuillez fournir entre 2 et 10 options séparées par des virgules.', '#DC2626');
                return interaction.reply({ embeds: [embed], ephemeral: true });
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
                const embed = createEmbed('❌ Erreur', 'Le salon #suggestions n\'existe pas sur ce serveur.', '#DC2626');
                return interaction.reply({ embeds: [embed], ephemeral: true });
            }
            const embed = createEmbed('💡 Nouvelle suggestion', suggestion, '#003DA5').setFooter({ text: `Par ${interaction.user.username}`, iconURL: interaction.user.displayAvatarURL({ size: 256 }) });
            const message = await suggestChannel.send({ embeds: [embed] });
            await message.react('✅'); await message.react('❌');
            const replyEmbed = createEmbed('✅ Succès', 'Ta suggestion a été envoyée avec succès !', '#059669');
            await interaction.reply({ embeds: [replyEmbed], ephemeral: true });
        }

        if (interaction.commandName === '8ball') {
            const responses = ['Oui, absolument !', 'Non, jamais.', 'Peut-être...', 'C\'est certain.', 'Je ne pense pas.', 'Absolument !', 'Demande plus tard.', 'Concentre-toi et redemande.', 'Ne compte pas dessus.', 'Oui, dans un futur proche.', 'Très douteux.', 'Sans aucun doute.', 'Ma réponse est non.', 'Il est certain que oui.', 'Les perspectives ne sont pas si bonnes.', 'C\'est décidément le cas.', 'Oui, définitivement.', 'Mieux vaut ne pas te le dire maintenant.', 'Mes sources disent non.', 'Oui, tu peux y compter.'];
            const embed = createEmbed('🎱 Boule Magique', `**Question :** ${interaction.options.getString('question')}\n**Réponse :** ${responses[Math.floor(Math.random() * responses.length)]}`, '#003DA5');
            await interaction.reply({ embeds: [embed] });
        }

        if (interaction.commandName === 'coinflip') {
            const result = Math.random() < 0.5 ? 'Pile' : 'Face';
            const embed = createEmbed('🪙 Pile ou Face', `Le résultat est : **${result}**`, '#003DA5');
            await interaction.reply({ embeds: [embed] });
        }

        if (interaction.commandName === 'dice') {
            const result = Math.floor(Math.random() * 6) + 1;
            const embed = createEmbed('🎲 Lancer de dé', `Tu as obtenu : **${result}**`, '#003DA5');
            await interaction.reply({ embeds: [embed] });
        }

        if (interaction.commandName === 'rps') {
            const choix = interaction.options.getString('choix');
            const choixBot = ['pierre', 'papier', 'ciseaux'][Math.floor(Math.random() * 3)];
            const emojis = { pierre: '🪨', papier: '📄', ciseaux: '✂️' };
            let result = choix === choixBot ? 'Match nul !' : ((choix === 'pierre' && choixBot === 'ciseaux') || (choix === 'papier' && choixBot === 'pierre') || (choix === 'ciseaux' && choixBot === 'papier')) ? 'Tu as gagné !' : 'Tu as perdu !';
            const embed = createEmbed('✂️ Pierre Papier Ciseaux', `${emojis[choix]} vs ${emojis[choixBot]}\n\n**Résultat :** ${result}`, '#003DA5');
            await interaction.reply({ embeds: [embed] });
        }

        if (interaction.commandName === 'remind') {
            const minutes = interaction.options.getInteger('minutes');
            const message = interaction.options.getString('message');
            client.reminders.set(interaction.user.id, { message, time: Date.now() + (minutes * 60 * 1000) });
            const embed = createEmbed('⏰ Rappel Défini', `Tu seras notifié dans **${minutes} minute(s)** pour : "${message}"`, '#003DA5');
            await interaction.reply({ embeds: [embed], ephemeral: true });
            setTimeout(async () => {
                try { 
                    const remindEmbed = createEmbed('⏰ Rappel', message, '#003DA5');
                    await interaction.user.send({ embeds: [remindEmbed] }); 
                    client.reminders.delete(interaction.user.id); 
                } catch (e) {}
            }, minutes * 60 * 1000);
        }

        if (interaction.commandName === 'afk') {
            const reason = interaction.options.getString('raison') || 'AFK';
            client.afkUsers.set(interaction.user.id, { username: interaction.user.username, reason, timestamp: Date.now() });
            const newName = `[AFK] ${interaction.member.displayName}`;
            if (newName.length <= 32) await interaction.member.setNickname(newName).catch(() => {});
            const embed = createEmbed('💤 Statut AFK', `Tu es maintenant AFK pour la raison : **${reason}**`, '#003DA5');
            await interaction.reply({ embeds: [embed] });
        }

        if (interaction.commandName === 'meme') {
            try {
                const res = await axios.get('https://meme-api.com/gimme');
                const embed = createEmbed(res.data.title, '', '#003DA5', [], res.data.url); // L'image du meme devient la miniature
                embed.setFooter({ text: `r/${res.data.subreddit}`, iconURL: SERVER_ICON }).setURL(res.data.postLink);
                await interaction.reply({ embeds: [embed] });
            } catch (e) { 
                const embed = createEmbed('❌ Erreur', 'Impossible de récupérer un meme pour le moment.', '#DC2626');
                await interaction.reply({ embeds: [embed], ephemeral: true }); 
            }
        }

        if (interaction.commandName === 'cat') {
            try {
                const res = await axios.get('https://api.thecatapi.com/v1/images/search');
                const embed = createEmbed('🐱 Chat Aléatoire', 'Voici un chat mignon pour égayer ta journée !', '#003DA5', [], res.data[0].url);
                await interaction.reply({ embeds: [embed] });
            } catch (e) { 
                const embed = createEmbed('❌ Erreur', 'Impossible de récupérer une image de chat.', '#DC2626');
                await interaction.reply({ embeds: [embed], ephemeral: true }); 
            }
        }

        if (interaction.commandName === 'dog') {
            try {
                const res = await axios.get('https://dog.ceo/api/breeds/image/random');
                const embed = createEmbed('🐶 Chien Aléatoire', 'Voici un toutou adorable !', '#003DA5', [], res.data.message);
                await interaction.reply({ embeds: [embed] });
            } catch (e) { 
                const embed = createEmbed('❌ Erreur', 'Impossible de récupérer une image de chien.', '#DC2626');
                await interaction.reply({ embeds: [embed], ephemeral: true }); 
            }
        }

        if (interaction.commandName === 'matricule') {
            const numero = interaction.options.getString('numero');
            const parts = interaction.member.displayName.split(' | ');
            const baseName = parts.length > 1 ? parts.slice(1).join(' | ') : interaction.member.displayName;
            const newName = `${numero} | ${baseName}`;
            if (newName.length > 32) {
                const embed = createEmbed('❌ Erreur', 'Le nouveau nom dépasse la limite de 32 caractères.', '#DC2626');
                return interaction.reply({ embeds: [embed], ephemeral: true });
            }
            try {
                await interaction.member.setNickname(newName);
                const embed = createEmbed('✅ Succès', `Ton nom a été mis à jour : **${newName}**`, '#059669');
                await interaction.reply({ embeds: [embed], ephemeral: true });
            } catch (error) { 
                const embed = createEmbed('❌ Erreur', 'Le bot n\'a pas la permission de modifier ton pseudo.', '#DC2626');
                await interaction.reply({ embeds: [embed], ephemeral: true }); 
            }
        }

        if (interaction.commandName === 'test') {
            const guild = interaction.guild;
            const owner = await guild.fetchOwner();
            const embed = createEmbed(
                `📊 Statistiques du Serveur`,
                `Voici un aperçu en temps réel de **${guild.name}**.`,
                '#003DA5',
                [
                    { name: '👥 Membres', value: `**${guild.memberCount}** membres\n🟢 **${guild.members.cache.filter(m => !m.user.bot && m.presence?.status !== 'offline').size}** en ligne`, inline: true },
                    { name: '📂 Catégories', value: `**${guild.channels.cache.filter(ch => ch.type === ChannelType.GuildCategory).size}**`, inline: true },
                    { name: '💬 Salons', value: `**${guild.channels.cache.size}** au total`, inline: true },
                    { name: '🎭 Rôles', value: `**${guild.roles.cache.size}** rôles`, inline: true },
                    { name: '😊 Emojis', value: `**${guild.emojis.cache.size}** personnalisés`, inline: true },
                    { name: '💎 Boosts', value: `**Niveau ${guild.premiumTier}**\n**${guild.premiumSubscriptionCount || 0}** boosts`, inline: true },
                    { name: '👑 Propriétaire', value: `${owner.user}`, inline: true },
                    { name: '📅 Création', value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:D>\n<t:${Math.floor(guild.createdTimestamp / 1000)}:R>`, inline: false }
                ],
                guild.iconURL({ size: 4096, dynamic: true })
            );

            const row1 = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder().setCustomId('test_stats').setLabel('📊 Stats').setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId('test_members').setLabel('👥 Membres').setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId('test_invite').setLabel('🔗 Invitation').setStyle(ButtonStyle.Success)
                );
            
            const row2 = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder().setCustomId('test_info').setLabel('ℹ️ Infos').setStyle(ButtonStyle.Info),
                    new ButtonBuilder().setCustomId('test_close').setLabel('❌ Fermer').setStyle(ButtonStyle.Danger)
                );

            await interaction.reply({ embeds: [embed], components: [row1, row2] });
        }

        if (interaction.commandName === 'ticket') {
            const existingTicket = interaction.guild.channels.cache.find(c => c.name === `ticket-${interaction.user.username}`);
            if (existingTicket) {
                const embed = createEmbed('❌ Erreur', 'Tu as déjà un ticket ouvert. Utilise `/close` pour le fermer.', '#DC2626');
                return interaction.reply({ embeds: [embed], ephemeral: true });
            }
            const ticketChannel = await interaction.guild.channels.create({ name: `ticket-${interaction.user.username}`, type: ChannelType.GuildText, topic: `Ticket de ${interaction.user.tag}`, permissionOverwrites: [{ id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] }, { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }, { id: interaction.guild.roles.cache.find(r => r.permissions.has(PermissionFlagsBits.ManageChannels))?.id || interaction.guild.ownerId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }] });
            
            await sendLog('🎫 Ticket Créé', `**${interaction.user.tag}** a ouvert un ticket : <#${ticketChannel.id}>`, '#4d8dff', [], interaction.user.displayAvatarURL({ size: 256 }));
            
            const ticketEmbed = createEmbed('🎫 Nouveau Ticket', `Bonjour ${interaction.user},\n\nUn membre du staff va prendre en charge ta demande sous peu.\n\n**Veuillez décrire ton problème ci-dessous.**`, '#003DA5');
            await ticketChannel.send({ content: `${interaction.user}`, embeds: [ticketEmbed] });
            
            const replyEmbed = createEmbed('✅ Succès', `Ton ticket a été créé avec succès : ${ticketChannel}`, '#059669');
            await interaction.reply({ embeds: [replyEmbed], ephemeral: true });
        }

        if (interaction.commandName === 'close') {
            if (!interaction.channel.name.startsWith('ticket-')) {
                const embed = createEmbed('❌ Erreur', 'Cette commande ne fonctionne que dans un salon de ticket.', '#DC2626');
                return interaction.reply({ embeds: [embed], ephemeral: true });
            }
            const embed = createEmbed('⏳ Fermeture en cours', 'Le ticket sera fermé et supprimé dans 5 secondes...', '#D97706');
            await interaction.reply({ embeds: [embed], ephemeral: true });
            setTimeout(async () => { 
                await sendLog('🔒 Ticket Fermé', `Le ticket **${interaction.channel.name}** a été fermé par **${interaction.user.tag}**.`, '#D97706', [], interaction.user.displayAvatarURL({ size: 256 }));
                await interaction.channel.delete(); 
            }, 5000);
        }

        if (interaction.commandName === 'warn') {
            const target = interaction.options.getUser('membre');
            const reason = interaction.options.getString('raison');
            const embed = createEmbed('⚠️ Avertissement Officiel', `Tu as reçu un avertissement de la part du staff.`, '#D97706', [
                { name: 'Modérateur', value: interaction.user.tag, inline: true },
                { name: 'Raison', value: reason, inline: false }
            ]);
            await sendLog('⚠️ Avertissement Donné', `**${interaction.user.tag}** a averti **${target.tag}**\nRaison: ${reason}`, '#D97706', [], target.displayAvatarURL({ size: 256 }));
            try { await target.send({ embeds: [embed] }); } catch (e) {}
            
            const replyEmbed = createEmbed('✅ Succès', `${target.tag} a été averti avec succès.`, '#059669');
            await interaction.reply({ embeds: [replyEmbed], ephemeral: true });
        }

        if (interaction.commandName === 'clear') {
            const amount = interaction.options.getInteger('nombre');
            await interaction.channel.bulkDelete(amount, true);
            await sendLog('🧹 Messages Supprimés', `**${interaction.user.tag}** a supprimé **${amount}** messages dans <#${interaction.channel.id}>.`, '#D97706', [], interaction.user.displayAvatarURL({ size: 256 }));
            const embed = createEmbed('✅ Nettoyage Effectué', `${amount} messages ont été supprimés avec succès.`, '#059669');
            const msg = await interaction.reply({ embeds: [embed], ephemeral: true, fetchReply: true });
            setTimeout(async () => { if (msg.deletable) await msg.delete(); }, 3000);
        }

        if (interaction.commandName === 'userinfo') {
            const member = interaction.options.getMember('membre') || interaction.member;
            const roles = member.roles.cache.filter(r => r.id !== member.guild.id).map(r => r.name).join(', ') || 'Aucun';
            // Ici, on met la PFP du membre en miniature
            const embed = createEmbed(`👤 Informations Utilisateur`, `Détails du profil de **${member.user.username}**.`, '#003DA5', [
                { name: '🏷️ Pseudo', value: member.displayName, inline: true },
                { name: '🆔 Identifiant', value: member.id, inline: true },
                { name: '📅 Compte créé', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:D>`, inline: true },
                { name: '🚪 A rejoint le', value: member.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:D>` : 'Inconnu', inline: true },
                { name: '🎭 Rôles', value: roles.substring(0, 1000), inline: false }
            ], member.user.displayAvatarURL({ size: 4096, dynamic: true }));
            await interaction.reply({ embeds: [embed] });
        }

        if (interaction.commandName === 'serverinfo') {
            const guild = interaction.guild;
            const owner = await guild.fetchOwner();
            const embed = createEmbed(`📊 Informations du Serveur`, `Voici les détails officiels de **${guild.name}**.`, '#003DA5', [
                { name: '👑 Propriétaire', value: `${owner.user}`, inline: true },
                { name: '🆔 Identifiant', value: guild.id, inline: true },
                { name: '👥 Membres', value: `${guild.memberCount} membres`, inline: true },
                { name: '📂 Catégories', value: `${guild.channels.cache.filter(c => c.type === ChannelType.GuildCategory).size}`, inline: true },
                { name: '💬 Salons', value: `${guild.channels.cache.size} au total`, inline: true },
                { name: '🎭 Rôles', value: `${guild.roles.cache.size}`, inline: true },
                { name: '📅 Création', value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:D>`, inline: false }
            ], guild.iconURL({ size: 4096, dynamic: true }));
            await interaction.reply({ embeds: [embed] });
        }

        if (interaction.commandName === 'scan') {
            if (interaction.user.id !== JACOBIN_ID) {
                const embed = createEmbed('❌ Accès Refusé', 'Cette commande est strictement réservée à Jacobin904.', '#DC2626');
                return interaction.reply({ embeds: [embed], ephemeral: true });
            }
            await interaction.deferReply({ ephemeral: true });
            try {
                const guild = interaction.guild;
                const items = [];
                items.push({ _type: 'server_info', id: guild.id, name: guild.name, memberCount: guild.memberCount, ownerId: guild.ownerId });
                guild.channels.cache.forEach(ch => items.push({ _type: 'channel', id: ch.id, name: ch.name, type: ChannelType[ch.type] }));
                guild.roles.cache.forEach(role => items.push({ _type: 'role', id: role.id, name: role.name, color: role.hexColor }));
                guild.members.cache.forEach(member => items.push({ _type: 'member', id: member.id, username: member.user.username, displayName: member.displayName }));
                
                items.sort((a, b) => JSON.stringify(b).length - JSON.stringify(a).length);
                const buckets = Array.from({ length: 10 }, () => ({ items: [], size: 0 }));
                for (const item of items) {
                    const itemSize = JSON.stringify(item).length;
                    const smallestBucket = buckets.reduce((prev, curr) => prev.size < curr.size ? prev : curr);
                    smallestBucket.items.push(item);
                    smallestBucket.size += itemSize;
                }

                const files = [];
                const timestamp = Date.now();
                const safeName = guild.name.replace(/\s+/g, '_');
                for (let i = 0; i < 10; i++) {
                    const metaData = { _meta: { file: i + 1, total_files: 10, server: guild.name, timestamp: new Date().toISOString(), item_count: buckets[i].items.length, estimated_size_kb: Math.round(buckets[i].size / 1024) }, data: buckets[i].items };
                    files.push({ attachment: Buffer.from(JSON.stringify(metaData, null, 2), 'utf-8'), name: `scan_part_${String(i + 1).padStart(2, '0')}_${safeName}_${timestamp}.json` });
                }
                const embed = createEmbed('✅ Scan Terminé', 'Le scan complet du serveur a été généré en 10 fichiers JSON équilibrés.', '#059669');
                await interaction.followUp({ embeds: [embed], files: files, ephemeral: true });
            } catch (error) {
                const embed = createEmbed('❌ Erreur', `Une erreur est survenue :\n\`\`\`js\n${error.message}\n\`\`\``, '#DC2626');
                await interaction.followUp({ embeds: [embed], ephemeral: true });
            }
        }

        const voiceCommands = ['lockvc', 'unlockvc', 'hidevc', 'showvc', 'limitvc', 'renamevc', 'kickvc', 'banvc', 'unbanvc', 'claimvc', 'vcinfo'];
        if (voiceCommands.includes(interaction.commandName)) {
            const member = interaction.member;
            const voiceChannel = member.voice.channel;
            if (!voiceChannel) {
                const embed = createEmbed('❌ Erreur', 'Tu dois être connecté à un salon vocal pour utiliser cette commande.', '#DC2626');
                return interaction.reply({ embeds: [embed], ephemeral: true });
            }
            if (interaction.commandName !== 'claimvc' && !isVoiceOwner(member, voiceChannel)) {
                const embed = createEmbed('❌ Erreur', 'Tu n\'es pas le propriétaire de ce salon vocal.', '#DC2626');
                return interaction.reply({ embeds: [embed], ephemeral: true });
            }
            
            if (interaction.commandName === 'lockvc') { 
                await voiceChannel.permissionOverwrites.edit(interaction.guild.id, { Connect: false }); 
                await sendLog('🔒 Vocal Verrouillé', `**${member.user.tag}** a verrouillé <#${voiceChannel.id}>.`, '#D97706', [], member.user.displayAvatarURL({ size: 256 }));
                const embed = createEmbed('🔒 Succès', 'Le salon vocal est maintenant verrouillé.', '#059669');
                await interaction.reply({ embeds: [embed], ephemeral: true }); 
            }
            if (interaction.commandName === 'unlockvc') { 
                await voiceChannel.permissionOverwrites.edit(interaction.guild.id, { Connect: null }); 
                await sendLog('🔓 Vocal Déverrouillé', `**${member.user.tag}** a déverrouillé <#${voiceChannel.id}>.`, '#059669', [], member.user.displayAvatarURL({ size: 256 }));
                const embed = createEmbed('🔓 Succès', 'Le salon vocal est maintenant déverrouillé.', '#059669');
                await interaction.reply({ embeds: [embed], ephemeral: true }); 
            }
            if (interaction.commandName === 'hidevc') { 
                await voiceChannel.permissionOverwrites.edit(interaction.guild.id, { ViewChannel: false }); 
                await sendLog('👻 Vocal Masqué', `**${member.user.tag}** a masqué <#${voiceChannel.id}>.`, '#D97706', [], member.user.displayAvatarURL({ size: 256 }));
                const embed = createEmbed('👻 Succès', 'Le salon vocal est maintenant masqué.', '#059669');
                await interaction.reply({ embeds: [embed], ephemeral: true }); 
            }
            if (interaction.commandName === 'showvc') { 
                await voiceChannel.permissionOverwrites.edit(interaction.guild.id, { ViewChannel: null }); 
                await sendLog('👁️ Vocal Visible', `**${member.user.tag}** a rendu visible <#${voiceChannel.id}>.`, '#059669', [], member.user.displayAvatarURL({ size: 256 }));
                const embed = createEmbed('👁️ Succès', 'Le salon vocal est maintenant visible.', '#059669');
                await interaction.reply({ embeds: [embed], ephemeral: true }); 
            }
            if (interaction.commandName === 'limitvc') { 
                const limit = interaction.options.getInteger('limite'); 
                await voiceChannel.setUserLimit(limit); 
                await sendLog('👥 Limite Vocale', `**${member.user.tag}** a mis la limite à ${limit} dans <#${voiceChannel.id}>.`, '#003DA5', [], member.user.displayAvatarURL({ size: 256 }));
                const embed = createEmbed('👥 Succès', `La limite du salon est maintenant de **${limit === 0 ? 'illimité' : limit}**.`, '#059669');
                await interaction.reply({ embeds: [embed], ephemeral: true }); 
            }
            if (interaction.commandName === 'renamevc') { 
                const nom = interaction.options.getString('nom'); 
                await voiceChannel.setName(nom); 
                await sendLog('✏️ Vocal Renommé', `**${member.user.tag}** a renommé le salon en "${nom}".`, '#003DA5', [], member.user.displayAvatarURL({ size: 256 }));
                const embed = createEmbed('✏️ Succès', `Le salon a été renommé en **${nom}**.`, '#059669');
                await interaction.reply({ embeds: [embed], ephemeral: true }); 
            }
            if (interaction.commandName === 'kickvc') { 
                const target = interaction.options.getMember('membre'); 
                if (!target.voice.channel || target.voice.channel.id !== voiceChannel.id) {
                    const embed = createEmbed('❌ Erreur', 'Ce membre n\'est pas dans ton salon vocal.', '#DC2626');
                    return interaction.reply({ embeds: [embed], ephemeral: true });
                }
                await target.voice.disconnect(); 
                await sendLog('👢 Kick Vocal', `**${member.user.tag}** a kick **${target.user.tag}** de <#${voiceChannel.id}>.`, '#D97706', [], member.user.displayAvatarURL({ size: 256 }));
                const embed = createEmbed('👢 Succès', `${target.user.tag} a été expulsé du salon.`, '#059669');
                await interaction.reply({ embeds: [embed], ephemeral: true }); 
            }
            if (interaction.commandName === 'banvc') { 
                const target = interaction.options.getMember('membre'); 
                if (!target.voice.channel || target.voice.channel.id !== voiceChannel.id) {
                    const embed = createEmbed('❌ Erreur', 'Ce membre n\'est pas dans ton salon vocal.', '#DC2626');
                    return interaction.reply({ embeds: [embed], ephemeral: true });
                }
                await voiceChannel.permissionOverwrites.edit(target.id, { Connect: false, ViewChannel: false }); 
                await target.voice.disconnect(); 
                await sendLog('🚫 Ban Vocal', `**${member.user.tag}** a banni **${target.user.tag}** de <#${voiceChannel.id}>.`, '#DC2626', [], member.user.displayAvatarURL({ size: 256 }));
                const embed = createEmbed('🚫 Succès', `${target.user.tag} a été banni du salon.`, '#059669');
                await interaction.reply({ embeds: [embed], ephemeral: true }); 
            }
            if (interaction.commandName === 'unbanvc') { 
                const target = interaction.options.getMember('membre'); 
                await voiceChannel.permissionOverwrites.delete(target.id); 
                await sendLog('✅ Débannissement Vocal', `**${member.user.tag}** a débanni **${target.user.tag}** de <#${voiceChannel.id}>.`, '#059669', [], member.user.displayAvatarURL({ size: 256 }));
                const embed = createEmbed('✅ Succès', `${target.user.tag} a été débanni du salon.`, '#059669');
                await interaction.reply({ embeds: [embed], ephemeral: true }); 
            }
            if (interaction.commandName === 'claimvc') {
                if (!client.tempVoiceChannels.has(voiceChannel.id)) {
                    const embed = createEmbed('❌ Erreur', 'Ce salon n\'est pas un salon vocal temporaire.', '#DC2626');
                    return interaction.reply({ embeds: [embed], ephemeral: true });
                }
                if (voiceChannel.members.has(client.tempVoiceChannels.get(voiceChannel.id))) {
                    const embed = createEmbed('❌ Erreur', 'Le propriétaire actuel est toujours dans le salon.', '#DC2626');
                    return interaction.reply({ embeds: [embed], ephemeral: true });
                }
                client.tempVoiceChannels.set(voiceChannel.id, member.id);
                await sendLog('👑 Propriété Réclamée', `**${member.user.tag}** a réclamé la propriété de <#${voiceChannel.id}>.`, '#003DA5', [], member.user.displayAvatarURL({ size: 256 }));
                const embed = createEmbed('👑 Succès', 'Tu es maintenant le propriétaire de ce salon.', '#059669');
                await interaction.reply({ embeds: [embed], ephemeral: true });
            }
            if (interaction.commandName === 'vcinfo') {
                const owner = client.tempVoiceChannels.get(voiceChannel.id);
                const ownerMember = owner ? interaction.guild.members.cache.get(owner) : null;
                const embed = createEmbed(`📊 Infos du Salon`, `Détails de **${voiceChannel.name}**.`, '#003DA5', [
                    { name: '🆔 Identifiant', value: voiceChannel.id, inline: true },
                    { name: '👑 Propriétaire', value: ownerMember ? ownerMember.user.tag : 'Aucun', inline: true },
                    { name: '👥 Membres', value: `${voiceChannel.members.size}`, inline: true },
                    { name: '🚪 Limite', value: voiceChannel.userLimit === 0 ? 'Illimité' : `${voiceChannel.userLimit}`, inline: true }
                ]);
                await interaction.reply({ embeds: [embed], ephemeral: true });
            }
        }
    }

    // --- BOUTONS ---
    if (interaction.isButton()) {
        if (interaction.customId === 'test_stats') {
            const embed = createEmbed('📊 Statistiques', 'Tu as consulté les statistiques rapides.', '#003DA5');
            await interaction.reply({ embeds: [embed], ephemeral: true });
        }
        if (interaction.customId === 'test_members') {
            const guild = interaction.guild;
            const online = guild.members.cache.filter(m => !m.user.bot && m.presence?.status !== 'offline').size;
            const embed = createEmbed('👥 Membres', `**En ligne :** ${online}\n**Total :** ${guild.memberCount}`, '#003DA5');
            await interaction.reply({ embeds: [embed], ephemeral: true });
        }
        if (interaction.customId === 'test_invite') {
            try {
                const invite = await interaction.channel.createInvite({ maxAge: 0, maxUses: 0 });
                const embed = createEmbed('🔗 Invitation', `Voici le lien d'invitation : ${invite.url}`, '#003DA5');
                await interaction.reply({ embeds: [embed], ephemeral: true });
            } catch (e) {
                const embed = createEmbed('❌ Erreur', 'Impossible de créer une invitation pour ce salon.', '#DC2626');
                await interaction.reply({ embeds: [embed], ephemeral: true });
            }
        }
        if (interaction.customId === 'test_info') {
            const embed = createEmbed('ℹ️ Informations', '**Bot développé pour Ville de Québec Roleplay**\nVersion: 3.0.0\nDéveloppeur: Jacobin Babouain', '#003DA5');
            await interaction.reply({ embeds: [embed], ephemeral: true });
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
                const embed = createEmbed('❌ Limite atteinte', 'Tu ne peux pas ajouter plus de 5 boutons.', '#DC2626');
                return interaction.reply({ embeds: [embed], ephemeral: true });
            }
            const modal = new ModalBuilder().setCustomId('modal_add_button').setTitle('Ajouter un bouton');
            modal.addComponents(
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('button_label').setLabel('Texte du bouton').setStyle(TextInputStyle.Short).setMaxLength(80).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('button_emoji').setLabel('Emoji (optionnel)').setStyle(TextInputStyle.Short).setMaxLength(50).setRequired(false)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('button_url').setLabel('URL du lien').setStyle(TextInputStyle.Short).setMaxLength(2048).setRequired(true))
            );
            await interaction.showModal(modal);
        }
        if (interaction.customId === 'remove_button') {
            if (embedData.buttons.length === 0) {
                const embed = createEmbed('❌ Erreur', 'Il n\'y a aucun bouton à retirer.', '#DC2626');
                return interaction.reply({ embeds: [embed], ephemeral: true });
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
            const embed = createEmbed('❌ Annulé', 'La création de l\'embed a été annulée.', '#DC2626');
            await interaction.reply({ embeds: [embed], ephemeral: true });
            try { const message = await interaction.channel.messages.fetch(embedData.messageId); await message.delete(); } catch (e) {}
        }
    }

    // --- MODALS ---
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
                const embed = createEmbed('❌ Erreur', 'Le salon spécifié est introuvable ou n\'est pas un salon texte.', '#DC2626');
                return interaction.reply({ embeds: [embed], ephemeral: true });
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
            
            const replyEmbed = createEmbed('✅ Succès', `L'embed a été envoyé avec succès dans ${targetChannel}.`, '#059669');
            await interaction.reply({ embeds: [replyEmbed], ephemeral: true });
            try { const message = await interaction.channel.messages.fetch(embedData.messageId); await message.delete(); } catch (e) {}
        }
    }
});

// ==========================================
// 9. MISE À JOUR DE LA PRÉVISUALISATION EMBED
// ==========================================
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
        const replyEmbed = createEmbed('✅ Mise à jour', `La prévisualisation a été mise à jour (${embedData.buttons.length} bouton(s)).`, '#059669');
        await interaction.reply({ embeds: [replyEmbed], ephemeral: true });
    } catch (e) { 
        const replyEmbed = createEmbed('❌ Erreur', 'Une erreur est survenue lors de la mise à jour.', '#DC2626');
        await interaction.reply({ embeds: [replyEmbed], ephemeral: true }); 
    }
}

// ==========================================
// 10. BASE DE DONNÉES GITHUB (CANDIDATURES)
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

        await sendLog('✅ Nouvelle Candidature', `**${d.roblox}** (${d.discord}) a soumis une candidature avec succès.`, '#059669');
        res.status(200).json({ success: true });
    } catch (error) {
        await sendLog('❌ Erreur Candidature', `Échec de l'enregistrement:\n\`\`\`js\n${error.message}\n\`\`\``, '#DC2626');
        res.status(500).json({ error: "Échec de l'enregistrement" });
    }
});

// ==========================================
// 11. CONNEXION FINALE
// ==========================================
if (!process.env.DISCORD_TOKEN) {
    console.error("[ERREUR CRITIQUE] La variable DISCORD_TOKEN est manquante dans les paramètres de l'hébergeur !");
    process.exit(1);
}

client.login(process.env.DISCORD_TOKEN).catch(err => {
    console.error("[ERREUR CRITIQUE] Échec de la connexion Discord. Vérifie ton token :", err.message);
    process.exit(1);
});

app.listen(PORT, HOST, () => {
    console.log(`[SERVEUR] Écoute active sur http://${HOST}:${PORT}`);
});
