require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { 
    Client, GatewayIntentBits, EmbedBuilder, SlashCommandBuilder, 
    REST, Routes, ChannelType, PermissionFlagsBits, 
    ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, 
    TextInputBuilder, TextInputStyle, PermissionsBitField
} = require('discord.js');

// ==========================================
// CONFIGURATION DES LOGS UNIVERSELS (TRIPLE SÉCURITÉ)
// ==========================================
const LOG_CHANNEL_ID = '1538659168012075029';
const LOG_WEBHOOK_URL = 'https://discord.com/api/webhooks/1538661235283857560/izzc3OJH6n6mVZPUo7JCxJUHdI6Q3y6CdWqvCsS4MP5AiPTNFpk7CFnufHZCVwV6WVXk';

async function sendUniversalLog(title, description, color = '#003DA5', fields = []) {
    const embedData = {
        title: title,
        description: description,
        color: parseInt(color.replace('#', ''), 16),
        fields: fields,
        timestamp: new Date().toISOString()
    };

    // NIVEAU 1 : Essayer d'envoyer via le canal Discord
    try {
        const channel = client.channels.cache.get(LOG_CHANNEL_ID);
        if (channel) {
            const embed = new EmbedBuilder()
                .setTitle(title)
                .setDescription(description)
                .setColor(color)
                .setTimestamp();
            if (fields.length > 0) embed.addFields(fields);
            await channel.send({ embeds: [embed] });
            return; // Succès, on s'arrête ici
        }
    } catch (err) {
        console.warn(`[LOG] Échec canal Discord, bascule vers Webhook... (${err.message})`);
    }

    // NIVEAU 2 : Essayer d'envoyer via le Webhook
    try {
        await axios.post(LOG_WEBHOOK_URL, { embeds: [embedData] });
        return; // Succès
    } catch (err) {
        console.error(`[LOG] Échec Webhook: ${err.message}`);
    }

    // NIVEAU 3 : Console (Jamais silencieux)
    console.error(`[LOG ULTIME] ${title} | ${description}`);
}

// Capture des crashs (Ne sera JAMAIS silencieux)
process.on('uncaughtException', (error) => {
    console.error('CRASH:', error);
    sendUniversalLog('🚨 CRITIQUE : Bot Crashé', `\`\`\`js\n${error.message}\n${error.stack}\n\`\`\``, '#DC2626');
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection:', reason);
    sendUniversalLog('⚠️ AVERTISSEMENT : Erreur de Promesse', `\`\`\`js\n${reason}\n\`\`\``, '#D97706');
});
// ==========================================

// 1. Serveur web pour Render (API + Site)
const app = express();
const port = process.env.PORT || 3000;
app.use(express.json());

app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    next();
});

app.get('/', (req, res) => res.send('Bot VQC en ligne'));

// 2. Client Discord
const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildModeration,
        GatewayIntentBits.GuildVoiceStates
    ] 
});

// Stockage
client.pendingEmbeds = new Map();
client.tempVoiceChannels = new Map();
client.afkUsers = new Map();
client.reminders = new Map();

const JOIN_CHANNEL_ID = '1537569455754969188';
const JACOBIN_ID = '1281784488854159421';
const GUILD_ID = process.env.GUILD_ID;

// 3. Commandes Slash
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
    new SlashCommandBuilder().setName('scan').setDescription('Scanner complet du serveur en 10 fichiers (Jacobin904 uniquement)')
];

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

client.once('clientReady', async () => {
    try {
        await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), { body: commands.map(cmd => cmd.toJSON()) });
        sendUniversalLog('✅ Bot Démarré', `Connecté en tant que **${client.user.tag}**\nCommandes enregistrées avec succès.`, '#059669');
    } catch (error) {
        sendUniversalLog('❌ Erreur Démarrage', `Échec de l'enregistrement des commandes:\n\`\`\`js\n${error.message}\n\`\`\``, '#DC2626');
    }
});

// ==========================================
// LOGS SERVEUR AUTOMATIQUES
// ==========================================
client.on('guildMemberAdd', async member => {
    sendUniversalLog('📥 Nouveau Membre', `**${member.user.tag}** (\`${member.id}\`)\nCompte créé: <t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, '#059669', [{ name: 'Avatar', value: `[Voir](${member.user.displayAvatarURL()})` }]);
});

client.on('guildMemberRemove', async member => {
    sendUniversalLog('📤 Membre Parti', `**${member.user.tag}** (\`${member.id}\`)\nA rejoint le: ${member.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:D>` : 'Inconnu'}`, '#DC2626', [{ name: 'Avatar', value: `[Voir](${member.user.displayAvatarURL()})` }]);
});

client.on('messageDelete', async message => {
    if (!message.author || message.author.bot || !message.content) return;
    sendUniversalLog('🗑️ Message Supprimé', `Auteur: **${message.author.tag}**\nCanal: <#${message.channel.id}>`, '#D97706', [{ name: 'Contenu', value: message.content.substring(0, 1000) }]);
});

// Système AFK
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

// 6. Système de Salon Vocal Temporaire
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
            sendUniversalLog('🎤 Vocal Créé', `**${displayName}** a créé le salon vocal <#${newChannel.id}>`, '#003DA5');
        } catch (error) { 
            sendUniversalLog('❌ Erreur Vocal', `Échec de la création du salon vocal:\n\`\`\`js\n${error.message}\n\`\`\``, '#DC2626');
        }
    }

    if (oldState.channelId && client.tempVoiceChannels.has(oldState.channelId)) {
        const channel = oldState.channel;
        if (channel && channel.members.size === 0) {
            await channel.delete().catch(console.error);
            client.tempVoiceChannels.delete(oldState.channelId);
            sendUniversalLog('🗑️ Vocal Supprimé', `Le salon vocal temporaire <#${oldState.channelId}> a été supprimé car vide.`, '#D97706');
        }
    }
});

function isVoiceOwner(member, channel) {
    if (!channel || !client.tempVoiceChannels.has(channel.id)) return false;
    return client.tempVoiceChannels.get(channel.id) === member.id;
}

// ==========================================
// API POUR LE SITE WEB
// ==========================================
const verifyApi = (req, res, next) => {
    const key = req.headers['x-api-key'];
    if (key === process.env.API_SECRET) return next();
    return res.status(401).json({ error: 'Non autorise' });
};

app.get('/api/stats', verifyApi, (req, res) => {
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

app.post('/api/log', async (req, res) => {
    const { source, level, message, details } = req.body;
    const colors = { info: '#003DA5', warn: '#D97706', error: '#DC2626', success: '#059669' };
    const emojis = { info: 'ℹ️', warn: '⚠️', error: '🚨', success: '✅' };
    
    const logFields = details ? [{ name: 'Détails', value: `\`\`\`json\n${JSON.stringify(details, null, 2).substring(0, 1000)}\n\`\`\`` }] : [];
    
    await sendUniversalLog(
        `${emojis[level] || '📝'} Log: ${source.toUpperCase()}`, 
        message, 
        colors[level] || '#003DA5', 
        logFields
    );
    res.status(200).json({ success: true });
});

// ==========================================
// GESTION DES COMMANDES SLASH
// ==========================================
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    // Log de TOUTES les commandes utilisées
    sendUniversalLog('⚡ Commande Utilisée', `**${interaction.user.tag}** a utilisé \`/${interaction.commandName}\`\nDans: <#${interaction.channel.id}>`, '#4d8dff', [{ name: 'Options', value: interaction.options.data.map(o => `${o.name}: ${o.value}`).join('\n') || 'Aucune' }]);

    if (interaction.commandName === 'ping') {
        await interaction.reply(`Pong ! Latence : ${client.ws.ping}ms`);
    }

    if (interaction.commandName === 'help') {
        const embed = new EmbedBuilder().setTitle('Liste des commandes').setColor('#003DA5')
            .addFields(
                { name: 'Salon Vocal', value: '`/lockvc` `/unlockvc` `/hidevc` `/showvc` `/limitvc` `/renamevc` `/kickvc` `/banvc` `/unbanvc` `/claimvc` `/vcinfo`', inline: false },
                { name: 'Fun', value: '`/8ball` `/coinflip` `/dice` `/rps` `/meme` `/cat` `/dog`', inline: false },
                { name: 'Utilitaires', value: '`/help` `/avatar` `/banner` `/roleinfo` `/channelinfo` `/invite` `/suggest` `/poll` `/say` `/announce` `/remind` `/afk`', inline: false },
                { name: 'Moderation', value: '`/warn` `/clear` `/ticket` `/close` `/embed` `/matricule`', inline: false }
            ).setTimestamp();
        await interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (interaction.commandName === 'invite') {
        await interaction.reply({ content: `[Clique ici pour inviter le bot](https://discord.com/api/oauth2/authorize?client_id=${client.user.id}&permissions=8&scope=bot%20applications.commands)` });
    }

    if (interaction.commandName === 'avatar') {
        const user = interaction.options.getUser('utilisateur') || interaction.user;
        await interaction.reply({ embeds: [new EmbedBuilder().setTitle(`Avatar de ${user.username}`).setImage(user.displayAvatarURL({ size: 4096, dynamic: true })).setColor('#003DA5')] });
    }

    if (interaction.commandName === 'banner') {
        const user = interaction.options.getUser('utilisateur') || interaction.user;
        const fetchedUser = await client.users.fetch(user.id, { force: true });
        if (fetchedUser.banner) {
            await interaction.reply({ embeds: [new EmbedBuilder().setTitle(`Banniere de ${user.username}`).setImage(fetchedUser.bannerURL({ size: 4096, dynamic: true })).setColor('#003DA5')] });
        } else {
            await interaction.reply({ content: 'Cet utilisateur n\'a pas de banniere.', ephemeral: true });
        }
    }

    if (interaction.commandName === 'serverbanner') {
        const banner = interaction.guild.bannerURL({ size: 4096, dynamic: true });
        if (banner) {
            await interaction.reply({ embeds: [new EmbedBuilder().setTitle(`Banniere de ${interaction.guild.name}`).setImage(banner).setColor('#003DA5')] });
        } else {
            await interaction.reply({ content: 'Ce serveur n\'a pas de banniere.', ephemeral: true });
        }
    }

    if (interaction.commandName === 'roleinfo') {
        const role = interaction.options.getRole('role');
        await interaction.reply({ embeds: [new EmbedBuilder().setTitle(`Infos sur le role : ${role.name}`).setColor(role.color || '#003DA5').addFields({ name: 'ID', value: role.id, inline: true }, { name: 'Position', value: `${role.position}`, inline: true }, { name: 'Membres', value: `${role.members.size}`, inline: true }).setTimestamp()] });
    }

    if (interaction.commandName === 'channelinfo') {
        const channel = interaction.options.getChannel('salon') || interaction.channel;
        await interaction.reply({ embeds: [new EmbedBuilder().setTitle(`Infos sur le salon : ${channel.name}`).setColor('#003DA5').addFields({ name: 'ID', value: channel.id, inline: true }, { name: 'Type', value: ChannelType[channel.type], inline: true }).setTimestamp()] });
    }

    if (interaction.commandName === 'say') {
        await interaction.channel.send(interaction.options.getString('message'));
        await interaction.reply({ content: 'Message envoye !', ephemeral: true });
    }

    if (interaction.commandName === 'announce') {
        const titre = interaction.options.getString('titre');
        const description = interaction.options.getString('description');
        const channel = interaction.options.getChannel('salon');
        await channel.send({ embeds: [new EmbedBuilder().setTitle(titre).setDescription(description).setColor('#003DA5').setFooter({ text: `Annonce par ${interaction.user.username}`, iconURL: interaction.user.displayAvatarURL() }).setTimestamp()] });
        await interaction.reply({ content: `Annonce envoyee dans ${channel} !`, ephemeral: true });
    }

    if (interaction.commandName === 'poll') {
        const question = interaction.options.getString('question');
        const options = interaction.options.getString('options').split(',').map(o => o.trim());
        if (options.length < 2 || options.length > 10) return interaction.reply({ content: 'Entre 2 et 10 options separees par des virgules.', ephemeral: true });
        const emojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
        const message = await interaction.reply({ embeds: [new EmbedBuilder().setTitle(`Sondage : ${question}`).setDescription(options.map((opt, i) => `${emojis[i]} ${opt}`).join('\n')).setColor('#003DA5').setFooter({ text: `Sondage par ${interaction.user.username}` }).setTimestamp()], fetchReply: true });
        for (let i = 0; i < options.length; i++) await message.react(emojis[i]);
    }

    if (interaction.commandName === 'suggest') {
        const suggestion = interaction.options.getString('suggestion');
        const suggestChannel = interaction.guild.channels.cache.find(c => c.name === 'suggestions');
        if (!suggestChannel) return interaction.reply({ content: 'Le salon #suggestions n\'existe pas.', ephemeral: true });
        const message = await suggestChannel.send({ embeds: [new EmbedBuilder().setTitle('Nouvelle suggestion').setDescription(suggestion).setColor('#003DA5').setFooter({ text: `Par ${interaction.user.username}`, iconURL: interaction.user.displayAvatarURL() }).setTimestamp()] });
        await message.react('✅');
        await message.react('❌');
        await interaction.reply({ content: 'Suggestion envoyee !', ephemeral: true });
    }

    if (interaction.commandName === '8ball') {
        const responses = ['Oui, absolument !', 'Non, jamais.', 'Peut-etre...', 'C\'est certain.', 'Je ne pense pas.', 'Absolument !', 'Demande plus tard.', 'Concentre-toi et redemande.', 'Ne compte pas dessus.', 'Oui, dans un futur proche.', 'Tres douteux.', 'Sans aucun doute.', 'Ma reponse est non.', 'Il est certain que oui.', 'Les perspectives ne sont pas si bonnes.', 'C\'est decidement le cas.', 'Oui, definitivement.', 'Mieux vaut ne pas te le dire maintenant.', 'Mes sources disent non.', 'Oui, tu peux y compter.'];
        await interaction.reply({ embeds: [new EmbedBuilder().setTitle('Boule Magique').addFields({ name: 'Question', value: interaction.options.getString('question') }, { name: 'Reponse', value: responses[Math.floor(Math.random() * responses.length)] }).setColor('#003DA5')] });
    }

    if (interaction.commandName === 'coinflip') await interaction.reply(Math.random() < 0.5 ? 'Pile !' : 'Face !');
    if (interaction.commandName === 'dice') {
        const result = Math.floor(Math.random() * 6) + 1;
        await interaction.reply(`Tu as obtenu : **${result}**`);
    }

    if (interaction.commandName === 'rps') {
        const choix = interaction.options.getString('choix');
        const choixBot = ['pierre', 'papier', 'ciseaux'][Math.floor(Math.random() * 3)];
        let result = choix === choixBot ? 'Match nul !' : ((choix === 'pierre' && choixBot === 'ciseaux') || (choix === 'papier' && choixBot === 'pierre') || (choix === 'ciseaux' && choixBot === 'papier')) ? 'Tu as gagne !' : 'Tu as perdu !';
        await interaction.reply(`**${result}**`);
    }

    if (interaction.commandName === 'remind') {
        const minutes = interaction.options.getInteger('minutes');
        const message = interaction.options.getString('message');
        client.reminders.set(interaction.user.id, { message, time: Date.now() + (minutes * 60 * 1000) });
        await interaction.reply({ content: `Rappel defini dans ${minutes} minute(s) : "${message}"`, ephemeral: true });
        setTimeout(async () => {
            try { await interaction.user.send(`Rappel : ${message}`); client.reminders.delete(interaction.user.id); } catch (e) {}
        }, minutes * 60 * 1000);
    }

    if (interaction.commandName === 'afk') {
        const reason = interaction.options.getString('raison') || 'AFK';
        client.afkUsers.set(interaction.user.id, { username: interaction.user.username, reason, timestamp: Date.now() });
        const newName = `[AFK] ${interaction.member.displayName}`;
        if (newName.length <= 32) await interaction.member.setNickname(newName).catch(() => {});
        await interaction.reply(`Tu es maintenant AFK : ${reason}`);
    }

    if (interaction.commandName === 'meme') {
        try {
            const res = await axios.get('https://meme-api.com/gimme');
            await interaction.reply({ embeds: [new EmbedBuilder().setTitle(res.data.title).setImage(res.data.url).setURL(res.data.postLink).setFooter({ text: `r/${res.data.subreddit}` }).setColor('#003DA5')] });
        } catch (e) { await interaction.reply({ content: 'Erreur meme.', ephemeral: true }); }
    }

    if (interaction.commandName === 'cat') {
        try {
            const res = await axios.get('https://api.thecatapi.com/v1/images/search');
            await interaction.reply({ embeds: [new EmbedBuilder().setTitle('Chat aleatoire').setImage(res.data[0].url).setColor('#003DA5')] });
        } catch (e) { await interaction.reply({ content: 'Erreur image.', ephemeral: true }); }
    }

    if (interaction.commandName === 'dog') {
        try {
            const res = await axios.get('https://dog.ceo/api/breeds/image/random');
            await interaction.reply({ embeds: [new EmbedBuilder().setTitle('Chien aleatoire').setImage(res.data.message).setColor('#003DA5')] });
        } catch (e) { await interaction.reply({ content: 'Erreur image.', ephemeral: true }); }
    }

    if (interaction.commandName === 'matricule') {
        const numero = interaction.options.getString('numero');
        const parts = interaction.member.displayName.split(' | ');
        const baseName = parts.length > 1 ? parts.slice(1).join(' | ') : interaction.member.displayName;
        const newName = `${numero} | ${baseName}`;
        if (newName.length > 32) return interaction.reply({ content: 'Depasse la limite de 32 caracteres.', ephemeral: true });
        try {
            await interaction.member.setNickname(newName);
            await interaction.reply({ content: `Nom mis a jour : **${newName}**`, ephemeral: true });
        } catch (error) { await interaction.reply({ content: 'Permission insuffisante.', ephemeral: true }); }
    }

    if (interaction.commandName === 'embed') {
        const previewEmbed = new EmbedBuilder().setTitle('Previsualisation de l\'embed').setDescription('Utilise les boutons ci-dessous.').setColor('#003DA5').setTimestamp();
        const row1 = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('edit_title').setLabel('Titre').setStyle(ButtonStyle.Primary), new ButtonBuilder().setCustomId('edit_description').setLabel('Description').setStyle(ButtonStyle.Primary), new ButtonBuilder().setCustomId('edit_image').setLabel('Image').setStyle(ButtonStyle.Primary), new ButtonBuilder().setCustomId('add_button').setLabel('Ajouter Bouton').setStyle(ButtonStyle.Secondary), new ButtonBuilder().setCustomId('remove_button').setLabel('Retirer Bouton').setStyle(ButtonStyle.Secondary));
        const row2 = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('send_embed').setLabel('Envoyer').setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId('cancel_embed').setLabel('Annuler').setStyle(ButtonStyle.Danger));
        const embedData = { authorId: interaction.user.id, channelId: interaction.channel.id, guildId: interaction.guild.id, embed: { title: null, description: null, image: null }, buttons: [] };
        client.pendingEmbeds.set(interaction.user.id, embedData);
        await interaction.reply({ embeds: [previewEmbed], components: [row1, row2] });
        const message = await interaction.fetchReply();
        embedData.messageId = message.id;
    }

    if (interaction.commandName === 'ticket') {
        const existingTicket = interaction.guild.channels.cache.find(c => c.name === `ticket-${interaction.user.username}`);
        if (existingTicket) return interaction.reply({ content: 'Tu as deja un ticket ouvert.', ephemeral: true });
        const ticketChannel = await interaction.guild.channels.create({ name: `ticket-${interaction.user.username}`, type: ChannelType.GuildText, topic: `Ticket de ${interaction.user.tag}`, permissionOverwrites: [{ id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] }, { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }, { id: interaction.guild.roles.cache.find(r => r.permissions.has(PermissionFlagsBits.ManageChannels))?.id || interaction.guild.ownerId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }] });
        sendUniversalLog('🎫 Ticket Créé', `**${interaction.user.tag}** a ouvert un ticket: <#${ticketChannel.id}>`, '#059669');
        await ticketChannel.send({ content: `${interaction.user}`, embeds: [new EmbedBuilder().setTitle('Nouveau ticket').setDescription(`Bonjour ${interaction.user}.\n\nDecris ton probleme ci-dessous.`).setColor('#003DA5').setTimestamp()] });
        await interaction.reply({ content: `Ticket cree : ${ticketChannel}`, ephemeral: true });
    }

    if (interaction.commandName === 'close') {
        if (!interaction.channel.name.startsWith('ticket-')) return interaction.reply({ content: 'Cette commande ne fonctionne que dans un ticket.', ephemeral: true });
        await interaction.reply({ content: 'Fermeture du ticket dans 5 secondes...', ephemeral: true });
        setTimeout(async () => { 
            sendUniversalLog('🔒 Ticket Fermé', `Le ticket **${interaction.channel.name}** a été fermé par **${interaction.user.tag}**`, '#D97706');
            await interaction.channel.delete(); 
        }, 5000);
    }

    if (interaction.commandName === 'warn') {
        const target = interaction.options.getUser('membre');
        const reason = interaction.options.getString('raison');
        const embed = new EmbedBuilder().setColor('#003DA5').setTitle('Avertissement').addFields({ name: 'Membre', value: `${target.tag} (${target.id})`, inline: true }, { name: 'Moderateur', value: interaction.user.tag, inline: true }, { name: 'Raison', value: reason }).setTimestamp();
        sendUniversalLog('⚠️ Avertissement Donné', `**${interaction.user.tag}** a averti **${target.tag}**\nRaison: ${reason}`, '#D97706');
        try { await target.send({ embeds: [embed] }); } catch (e) {}
        await interaction.reply({ content: `${target.tag} a ete averti.`, ephemeral: true });
    }

    if (interaction.commandName === 'clear') {
        const amount = interaction.options.getInteger('nombre');
        await interaction.channel.bulkDelete(amount, true);
        sendUniversalLog('🧹 Messages Supprimés', `**${interaction.user.tag}** a supprimé **${amount}** messages dans <#${interaction.channel.id}>`, '#D97706');
        const msg = await interaction.reply({ content: `${amount} messages supprimes.`, ephemeral: true, fetchReply: true });
        setTimeout(async () => { if (msg.deletable) await msg.delete(); }, 3000);
    }

    if (interaction.commandName === 'userinfo') {
        const member = interaction.options.getMember('membre') || interaction.member;
        await interaction.reply({ embeds: [new EmbedBuilder().setTitle(`Informations : ${member.user.username}`).setColor('#003DA5').setThumbnail(member.user.displayAvatarURL({ size: 256 })).addFields({ name: 'Tag', value: member.user.tag, inline: true }, { name: 'ID', value: member.id, inline: true }, { name: 'Compte cree', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:D>`, inline: true }, { name: 'A rejoint', value: member.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:D>` : 'Inconnu', inline: true }).setTimestamp()] });
    }

    if (interaction.commandName === 'serverinfo') {
        const guild = interaction.guild;
        await interaction.reply({ embeds: [new EmbedBuilder().setTitle(`Informations du serveur : ${guild.name}`).setColor('#003DA5').setThumbnail(guild.iconURL()).addFields({ name: 'ID', value: guild.id, inline: true }, { name: 'Proprietaire', value: `<@${guild.ownerId}>`, inline: true }, { name: 'Membres', value: `${guild.memberCount}`, inline: true }).setTimestamp()] });
    }

    // === COMMANDES DE SALON VOCAL ===
    const voiceCommands = ['lockvc', 'unlockvc', 'hidevc', 'showvc', 'limitvc', 'renamevc', 'kickvc', 'banvc', 'unbanvc', 'claimvc', 'vcinfo'];
    if (voiceCommands.includes(interaction.commandName)) {
        const member = interaction.member;
        const voiceChannel = member.voice.channel;
        if (!voiceChannel) return interaction.reply({ content: 'Tu dois etre dans un salon vocal.', ephemeral: true });
        if (interaction.commandName !== 'claimvc' && !isVoiceOwner(member, voiceChannel)) return interaction.reply({ content: 'Tu n\'es pas le proprietaire de ce salon.', ephemeral: true });
        
        if (interaction.commandName === 'lockvc') { await voiceChannel.permissionOverwrites.edit(interaction.guild.id, { Connect: false }); await interaction.reply('Salon verrouille.'); sendUniversalLog('🔒 Vocal Verrouillé', `**${member.user.tag}** a verrouillé <#${voiceChannel.id}>`, '#D97706'); }
        if (interaction.commandName === 'unlockvc') { await voiceChannel.permissionOverwrites.edit(interaction.guild.id, { Connect: null }); await interaction.reply('Salon deverrouille.'); sendUniversalLog('🔓 Vocal Déverrouillé', `**${member.user.tag}** a déverrouillé <#${voiceChannel.id}>`, '#059669'); }
        if (interaction.commandName === 'hidevc') { await voiceChannel.permissionOverwrites.edit(interaction.guild.id, { ViewChannel: false }); await interaction.reply('Salon masque.'); sendUniversalLog('👻 Vocal Masqué', `**${member.user.tag}** a masqué <#${voiceChannel.id}>`, '#D97706'); }
        if (interaction.commandName === 'showvc') { await voiceChannel.permissionOverwrites.edit(interaction.guild.id, { ViewChannel: null }); await interaction.reply('Salon visible.'); sendUniversalLog('👁️ Vocal Visible', `**${member.user.tag}** a rendu visible <#${voiceChannel.id}>`, '#059669'); }
        if (interaction.commandName === 'limitvc') { const limit = interaction.options.getInteger('limite'); await voiceChannel.setUserLimit(limit); await interaction.reply(`Limite definie a ${limit === 0 ? 'illimite' : limit}.`); sendUniversalLog('👥 Limite Vocal', `**${member.user.tag}** a mis la limite à ${limit} dans <#${voiceChannel.id}>`, '#003DA5'); }
        if (interaction.commandName === 'renamevc') { const nom = interaction.options.getString('nom'); await voiceChannel.setName(nom); await interaction.reply(`Salon renomme en **${nom}**.`); sendUniversalLog('✏️ Vocal Renommé', `**${member.user.tag}** a renommé le salon en "${nom}"`, '#003DA5'); }
        if (interaction.commandName === 'kickvc') { const target = interaction.options.getMember('membre'); if (!target.voice.channel || target.voice.channel.id !== voiceChannel.id) return interaction.reply({ content: 'Ce membre n\'est pas dans ton salon.', ephemeral: true }); await target.voice.disconnect(); await interaction.reply(`${target.user.tag} a ete kick.`); sendUniversalLog('👢 Kick Vocal', `**${member.user.tag}** a kick **${target.user.tag}** de <#${voiceChannel.id}>`, '#D97706'); }
        if (interaction.commandName === 'banvc') { const target = interaction.options.getMember('membre'); if (!target.voice.channel || target.voice.channel.id !== voiceChannel.id) return interaction.reply({ content: 'Ce membre n\'est pas dans ton salon.', ephemeral: true }); await voiceChannel.permissionOverwrites.edit(target.id, { Connect: false, ViewChannel: false }); await target.voice.disconnect(); await interaction.reply(`${target.user.tag} a ete banni.`); sendUniversalLog('🚫 Ban Vocal', `**${member.user.tag}** a banni **${target.user.tag}** de <#${voiceChannel.id}>`, '#DC2626'); }
        if (interaction.commandName === 'unbanvc') { const target = interaction.options.getMember('membre'); await voiceChannel.permissionOverwrites.delete(target.id); await interaction.reply(`${target.user.tag} a ete debanni.`); sendUniversalLog('✅ Débannissement Vocal', `**${member.user.tag}** a débanni **${target.user.tag}** de <#${voiceChannel.id}>`, '#059669'); }
        if (interaction.commandName === 'claimvc') {
            if (!client.tempVoiceChannels.has(voiceChannel.id)) return interaction.reply({ content: 'Ce salon n\'est pas temporaire.', ephemeral: true });
            if (voiceChannel.members.has(client.tempVoiceChannels.get(voiceChannel.id))) return interaction.reply({ content: 'Le proprietaire est toujours dans le salon.', ephemeral: true });
            client.tempVoiceChannels.set(voiceChannel.id, member.id);
            await interaction.reply('Tu as reclame la propriete.');
            sendUniversalLog('👑 Propriété Réclamée', `**${member.user.tag}** a réclamé la propriété de <#${voiceChannel.id}>`, '#003DA5');
        }
        if (interaction.commandName === 'vcinfo') {
            const owner = client.tempVoiceChannels.get(voiceChannel.id);
            const ownerMember = owner ? interaction.guild.members.cache.get(owner) : null;
            await interaction.reply({ embeds: [new EmbedBuilder().setTitle(`Infos : ${voiceChannel.name}`).setColor('#003DA5').addFields({ name: 'ID', value: voiceChannel.id, inline: true }, { name: 'Proprietaire', value: ownerMember ? ownerMember.user.tag : 'Aucun', inline: true }, { name: 'Membres', value: `${voiceChannel.members.size}`, inline: true }, { name: 'Limite', value: voiceChannel.userLimit === 0 ? 'Illimite' : `${voiceChannel.userLimit}`, inline: true }).setTimestamp()] });
        }
    }
});

// 8. Gestion des boutons et modals (Embed)
client.on('interactionCreate', async interaction => {
    if (interaction.isButton()) {
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
            if (embedData.buttons.length >= 5) return interaction.reply({ content: 'Maximum 5 boutons atteint.', ephemeral: true });
            const modal = new ModalBuilder().setCustomId('modal_add_button').setTitle('Ajouter un bouton');
            modal.addComponents(
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('button_label').setLabel('Texte du bouton').setStyle(TextInputStyle.Short).setMaxLength(80).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('button_emoji').setLabel('Emoji (optionnel)').setStyle(TextInputStyle.Short).setMaxLength(50).setRequired(false)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('button_url').setLabel('URL du lien').setStyle(TextInputStyle.Short).setMaxLength(2048).setRequired(true))
            );
            await interaction.showModal(modal);
        }
        if (interaction.customId === 'remove_button') {
            if (embedData.buttons.length === 0) return interaction.reply({ content: 'Aucun bouton a retirer.', ephemeral: true });
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
            await interaction.reply({ content: 'Creation annulee.', ephemeral: true });
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
            if (!targetChannel || !targetChannel.isTextBased()) return interaction.reply({ content: 'Salon introuvable.', ephemeral: true });
            
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
            sendUniversalLog('📤 Embed Envoyé', `**${interaction.user.tag}** a envoyé un embed dans <#${targetChannel.id}>`, '#059669');
            await targetChannel.send({ embeds: [finalEmbed], components: components });
            client.pendingEmbeds.delete(interaction.user.id);
            await interaction.reply({ content: `Embed envoye dans ${targetChannel}`, ephemeral: true });
            try { const message = await interaction.channel.messages.fetch(embedData.messageId); await message.delete(); } catch (e) {}
        }
    }
});

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
        await interaction.reply({ content: `Previsualisation mise a jour (${embedData.buttons.length} bouton(s))`, ephemeral: true });
    } catch (e) { await interaction.reply({ content: 'Erreur lors de la mise a jour.', ephemeral: true }); }
}

// 9. Base
