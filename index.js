require('dotenv').config();
const express = require('express');
const { 
    Client, GatewayIntentBits, EmbedBuilder, SlashCommandBuilder, 
    REST, Routes, ChannelType, PermissionFlagsBits, 
    ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, 
    TextInputBuilder, TextInputStyle, PermissionsBitField
} = require('discord.js');

// 1. Serveur web pour Render
const app = express();
const port = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Bot VQC en ligne'));
app.listen(port, () => console.log(`Serveur actif sur le port ${port}`));

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

// ID du salon "Créer ton vocal"
const JOIN_CHANNEL_ID = '1537569455754969188';

// 3. Commandes Slash
const commands = [
    // === COMMANDES GÉNÉRALES ===
    new SlashCommandBuilder().setName('ping').setDescription('Vérifie la latence du bot.'),
    new SlashCommandBuilder().setName('help').setDescription('Affiche la liste des commandes.'),
    new SlashCommandBuilder().setName('invite').setDescription('Obtenir le lien d\'invitation du bot.'),
    new SlashCommandBuilder().setName('avatar').setDescription('Voir l\'avatar d\'un utilisateur.')
        .addUserOption(option => option.setName('utilisateur').setDescription('L\'utilisateur')),
    new SlashCommandBuilder().setName('banner').setDescription('Voir la bannière d\'un utilisateur.')
        .addUserOption(option => option.setName('utilisateur').setDescription('L\'utilisateur')),
    new SlashCommandBuilder().setName('serverbanner').setDescription('Voir la bannière du serveur.'),
    new SlashCommandBuilder().setName('roleinfo').setDescription('Infos sur un rôle.')
        .addRoleOption(option => option.setName('role').setDescription('Le rôle').setRequired(true)),
    new SlashCommandBuilder().setName('channelinfo').setDescription('Infos sur un salon.')
        .addChannelOption(option => option.setName('salon').setDescription('Le salon')),
    new SlashCommandBuilder().setName('say').setDescription('Faire dire quelque chose au bot.')
        .addStringOption(option => option.setName('message').setDescription('Le message').setRequired(true)),
    new SlashCommandBuilder().setName('announce').setDescription('Créer une annonce.')
        .addStringOption(option => option.setName('titre').setDescription('Titre').setRequired(true))
        .addStringOption(option => option.setName('description').setDescription('Description').setRequired(true))
        .addChannelOption(option => option.setName('salon').setDescription('Salon de destination').setRequired(true)),
    new SlashCommandBuilder().setName('poll').setDescription('Créer un sondage.')
        .addStringOption(option => option.setName('question').setDescription('La question').setRequired(true))
        .addStringOption(option => option.setName('options').setDescription('Options séparées par des virgules').setRequired(true)),
    new SlashCommandBuilder().setName('suggest').setDescription('Faire une suggestion.')
        .addStringOption(option => option.setName('suggestion').setDescription('Ta suggestion').setRequired(true)),
    new SlashCommandBuilder().setName('8ball').setDescription('Pose une question à la boule magique.')
        .addStringOption(option => option.setName('question').setDescription('Ta question').setRequired(true)),
    new SlashCommandBuilder().setName('coinflip').setDescription('Pile ou face.'),
    new SlashCommandBuilder().setName('dice').setDescription('Lancer un dé.'),
    new SlashCommandBuilder().setName('rps').setDescription('Pierre papier ciseaux.')
        .addStringOption(option => option.setName('choix').setDescription('Pierre, papier ou ciseaux').setRequired(true).addChoices(
            { name: 'Pierre', value: 'pierre' },
            { name: 'Papier', value: 'papier' },
            { name: 'Ciseaux', value: 'ciseaux' }
        )),
    new SlashCommandBuilder().setName('remind').setDescription('Définir un rappel.')
        .addIntegerOption(option => option.setName('minutes').setDescription('Dans combien de minutes').setRequired(true))
        .addStringOption(option => option.setName('message').setDescription('Le rappel').setRequired(true)),
    new SlashCommandBuilder().setName('afk').setDescription('Définir ton statut AFK.')
        .addStringOption(option => option.setName('raison').setDescription('Raison de ton AFK')),
    new SlashCommandBuilder().setName('meme').setDescription('Meme aléatoire.'),
    new SlashCommandBuilder().setName('cat').setDescription('Image de chat aléatoire.'),
    new SlashCommandBuilder().setName('dog').setDescription('Image de chien aléatoire.'),
    
    // === COMMANDES DE MODÉRATION ===
    new SlashCommandBuilder().setName('embed').setDescription('Crée un embed interactif avec previsualisation.'),
    new SlashCommandBuilder().setName('ticket').setDescription('Ouvre un ticket de support.'),
    new SlashCommandBuilder().setName('close').setDescription('Ferme le ticket actuel.').setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
    new SlashCommandBuilder().setName('warn').setDescription('Avertir un membre.').setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .addUserOption(option => option.setName('membre').setDescription('Le membre a avertir').setRequired(true))
        .addStringOption(option => option.setName('raison').setDescription('Raison de l\'avertissement').setRequired(true)),
    new SlashCommandBuilder().setName('clear').setDescription('Supprime des messages.').setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
        .addIntegerOption(option => option.setName('nombre').setDescription('Nombre de messages a supprimer (max 100)').setRequired(true).setMinValue(1).setMaxValue(100)),
    new SlashCommandBuilder().setName('userinfo').setDescription('Affiche les informations d\'un utilisateur.')
        .addUserOption(option => option.setName('membre').setDescription('Le membre dont voir les infos')),
    new SlashCommandBuilder().setName('serverinfo').setDescription('Affiche les informations du serveur.'),
    new SlashCommandBuilder().setName('matricule').setDescription('Définit ou met à jour votre matricule.')
        .addStringOption(option => option.setName('numero').setDescription('Votre numéro de matricule (ex: 12-43)').setRequired(true)),
    new SlashCommandBuilder()
    .setName('scan')
    .setDescription('🔒 Commande admin : Scanner complet du serveur (Jacobin904 uniquement)')
    
    // === COMMANDES DE SALON VOCAL (PROPRIÉTAIRE) ===
    new SlashCommandBuilder().setName('lockvc').setDescription('Verrouiller le salon vocal.'),
    new SlashCommandBuilder().setName('unlockvc').setDescription('Déverrouiller le salon vocal.'),
    new SlashCommandBuilder().setName('hidevc').setDescription('Cacher le salon vocal.'),
    new SlashCommandBuilder().setName('showvc').setDescription('Rendre le salon vocal visible.'),
    new SlashCommandBuilder().setName('limitvc').setDescription('Limiter le nombre de personnes dans le salon.')
        .addIntegerOption(option => option.setName('limite').setDescription('Nombre maximum de personnes (0 = illimité)').setRequired(true).setMinValue(0).setMaxValue(99)),
    new SlashCommandBuilder().setName('renamevc').setDescription('Renommer le salon vocal.')
        .addStringOption(option => option.setName('nom').setDescription('Nouveau nom du salon').setRequired(true)),
    new SlashCommandBuilder().setName('kickvc').setDescription('Kick quelqu\'un du salon vocal.')
        .addUserOption(option => option.setName('membre').setDescription('Le membre a kick').setRequired(true)),
    new SlashCommandBuilder().setName('banvc').setDescription('Bannir quelqu\'un du salon vocal.')
        .addUserOption(option => option.setName('membre').setDescription('Le membre a bannir').setRequired(true)),
    new SlashCommandBuilder().setName('unbanvc').setDescription('Débannir quelqu\'un du salon vocal.')
        .addUserOption(option => option.setName('membre').setDescription('Le membre a débannir').setRequired(true)),
    new SlashCommandBuilder().setName('claimvc').setDescription('Réclamer la propriété du salon si le proprio a quitté.'),
    new SlashCommandBuilder().setName('vcinfo').setDescription('Voir les infos du salon vocal.')
];

// 4. Enregistrement des commandes
const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

client.once('clientReady', async () => {
    console.log(`Connecte en tant que ${client.user.tag}`);
    try {
        await rest.put(Routes.applicationGuildCommands(client.user.id, process.env.GUILD_ID), { body: commands.map(cmd => cmd.toJSON()) });
        console.log('Commandes enregistrees');
    } catch (error) { console.error('Erreur:', error); }
});

// 5. Système de logs
client.on('guildMemberAdd', async member => {
    const logsChannel = member.guild.channels.cache.find(c => c.name === 'logs' || c.name === 'journaux');
    if (!logsChannel) return;
    await logsChannel.send({ embeds: [new EmbedBuilder().setColor('#003DA5').setTitle('Nouveau membre').addFields({ name: 'Membre', value: `${member.user.tag} (${member.id})`, inline: true }, { name: 'Compte cree', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, inline: true }).setThumbnail(member.user.displayAvatarURL()).setTimestamp()] });
});

client.on('guildMemberRemove', async member => {
    const logsChannel = member.guild.channels.cache.find(c => c.name === 'logs' || c.name === 'journaux');
    if (!logsChannel) return;
    await logsChannel.send({ embeds: [new EmbedBuilder().setColor('#003DA5').setTitle('Membre parti').addFields({ name: 'Membre', value: `${member.user.tag} (${member.id})`, inline: true }, { name: 'A rejoint le', value: member.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:D>` : 'Inconnu', inline: true }).setThumbnail(member.user.displayAvatarURL()).setTimestamp()] });
});

client.on('messageDelete', async message => {
    if (!message.author || message.author.bot) return;
    const logsChannel = message.guild.channels.cache.find(c => c.name === 'logs' || c.name === 'journaux');
    if (!logsChannel) return;
    await logsChannel.send({ embeds: [new EmbedBuilder().setColor('#003DA5').setTitle('Message supprime').addFields({ name: 'Auteur', value: `${message.author.tag} (${message.author.id})`, inline: true }, { name: 'Canal', value: `<#${message.channel.id}>`, inline: true }, { name: 'Contenu', value: message.content.substring(0, 1000) || 'Message sans texte' }).setTimestamp()] });
});

// Système AFK
client.on('messageCreate', async message => {
    if (message.author.bot) return;
    
    // Vérifier si quelqu'un mentionne un utilisateur AFK
    if (message.mentions.users.size > 0) {
        for (const [userId, afkData] of client.afkUsers) {
            if (message.mentions.users.has(userId)) {
                await message.reply(`${afkData.username} est AFK : ${afkData.reason} (depuis <t:${Math.floor(afkData.timestamp / 1000)}:R>)`);
            }
        }
    }
    
    // Si l'utilisateur qui parle est AFK, on retire son statut
    if (client.afkUsers.has(message.author.id)) {
        const afkData = client.afkUsers.get(message.author.id);
        client.afkUsers.delete(message.author.id);
        await message.reply(`Bienvenue de retour ${message.author} ! Tu n'es plus AFK.`);
        
        // Retirer [AFK] du pseudo
        if (message.member.displayName.startsWith('[AFK] ')) {
            const newName = message.member.displayName.replace('[AFK] ', '');
            await message.member.setNickname(newName).catch(() => {});
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
                inheritedOverwrites.push({
                    id: overwrite.id,
                    type: overwrite.type,
                    allow: overwrite.allow,
                    deny: overwrite.deny
                });
            });

            const ownerPermissions = new PermissionsBitField([
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.Connect,
                PermissionFlagsBits.Speak,
                PermissionFlagsBits.PrioritySpeaker,
                PermissionFlagsBits.MuteMembers,
                PermissionFlagsBits.DeafenMembers,
                PermissionFlagsBits.MoveMembers,
                PermissionFlagsBits.ManageChannels
            ]);

            const newChannel = await newState.guild.channels.create({
                name: `Vocal ${displayName}`,
                type: ChannelType.GuildVoice,
                parent: category ? category.id : null,
                permissionOverwrites: [
                    ...inheritedOverwrites,
                    {
                        id: member.id,
                        type: 0,
                        allow: ownerPermissions
                    }
                ]
            });

            await member.voice.setChannel(newChannel);
            client.tempVoiceChannels.set(newChannel.id, member.id);
            await newChannel.send(`Bienvenue **${displayName}** ! Tu es le propriétaire de ce salon vocal.`).catch(() => {});
            
        } catch (error) {
            console.error('Erreur création salon vocal:', error);
        }
    }

    if (oldState.channelId && client.tempVoiceChannels.has(oldState.channelId)) {
        const channel = oldState.channel;
        if (channel && channel.members.size === 0) {
            await channel.delete().catch(console.error);
            client.tempVoiceChannels.delete(oldState.channelId);
        }
    }
});

// Fonction utilitaire pour vérifier si l'utilisateur est le propriétaire du salon vocal
function isVoiceOwner(member, channel) {
    if (!channel || !client.tempVoiceChannels.has(channel.id)) return false;
    return client.tempVoiceChannels.get(channel.id) === member.id;
}

// 7. Gestion des commandes Slash
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    // === COMMANDES GÉNÉRALES ===
    if (interaction.commandName === 'ping') {
        await interaction.reply(`Pong ! Latence : ${client.ws.ping}ms`);
    }

    if (interaction.commandName === 'help') {
        const embed = new EmbedBuilder()
            .setTitle('📖 Liste des commandes')
            .setDescription('Voici toutes les commandes disponibles :')
            .setColor('#003DA5')
            .addFields(
                { name: '🎤 Commandes Salon Vocal (Propriétaire)', value: '`/lockvc` `/unlockvc` `/hidevc` `/showvc` `/limitvc` `/renamevc` `/kickvc` `/banvc` `/unbanvc` `/claimvc` `/vcinfo`', inline: false },
                { name: '🎮 Commandes Fun', value: '`/8ball` `/coinflip` `/dice` `/rps` `/meme` `/cat` `/dog`', inline: false },
                { name: '🔧 Commandes Utilitaires', value: '`/help` `/avatar` `/banner` `/serverbanner` `/roleinfo` `/channelinfo` `/invite` `/suggest` `/poll` `/say` `/announce` `/remind` `/afk`', inline: false },
                { name: '🛡️ Commandes Modération', value: '`/warn` `/clear` `/ticket` `/close` `/embed` `/matricule`', inline: false },
                { name: 'ℹ️ Commandes Info', value: '`/ping` `/userinfo` `/serverinfo`', inline: false }
            )
            .setTimestamp();
        await interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (interaction.commandName === 'invite') {
        const embed = new EmbedBuilder()
            .setTitle('🔗 Invitation du bot')
            .setDescription(`[Clique ici pour inviter le bot](https://discord.com/api/oauth2/authorize?client_id=${client.user.id}&permissions=8&scope=bot%20applications.commands)`)
            .setColor('#003DA5');
        await interaction.reply({ embeds: [embed] });
    }

    if (interaction.commandName === 'avatar') {
        const user = interaction.options.getUser('utilisateur') || interaction.user;
        const embed = new EmbedBuilder()
            .setTitle(`Avatar de ${user.username}`)
            .setImage(user.displayAvatarURL({ size: 4096, dynamic: true }))
            .setColor('#003DA5');
        await interaction.reply({ embeds: [embed] });
    }

    if (interaction.commandName === 'banner') {
        const user = interaction.options.getUser('utilisateur') || interaction.user;
        const fetchedUser = await client.users.fetch(user.id, { force: true });
        if (fetchedUser.banner) {
            const embed = new EmbedBuilder()
                .setTitle(`Bannière de ${user.username}`)
                .setImage(fetchedUser.bannerURL({ size: 4096, dynamic: true }))
                .setColor('#003DA5');
            await interaction.reply({ embeds: [embed] });
        } else {
            await interaction.reply({ content: 'Cet utilisateur n\'a pas de bannière.', ephemeral: true });
        }
    }

    if (interaction.commandName === 'serverbanner') {
        const banner = interaction.guild.bannerURL({ size: 4096, dynamic: true });
        if (banner) {
            const embed = new EmbedBuilder()
                .setTitle(`Bannière de ${interaction.guild.name}`)
                .setImage(banner)
                .setColor('#003DA5');
            await interaction.reply({ embeds: [embed] });
        } else {
            await interaction.reply({ content: 'Ce serveur n\'a pas de bannière.', ephemeral: true });
        }
    }

    if (interaction.commandName === 'roleinfo') {
        const role = interaction.options.getRole('role');
        const embed = new EmbedBuilder()
            .setTitle(`Infos sur le rôle : ${role.name}`)
            .setColor(role.color || '#003DA5')
            .addFields(
                { name: 'ID', value: role.id, inline: true },
                { name: 'Couleur', value: `#${role.color.toString(16).padStart(6, '0')}`, inline: true },
                { name: 'Position', value: `${role.position}`, inline: true },
                { name: 'Membres', value: `${role.members.size}`, inline: true },
                { name: 'Mentionnable', value: role.mentionable ? 'Oui' : 'Non', inline: true },
                { name: 'Créé le', value: `<t:${Math.floor(role.createdTimestamp / 1000)}:D>`, inline: true }
            )
            .setTimestamp();
        await interaction.reply({ embeds: [embed] });
    }

    if (interaction.commandName === 'channelinfo') {
        const channel = interaction.options.getChannel('salon') || interaction.channel;
        const embed = new EmbedBuilder()
            .setTitle(`Infos sur le salon : ${channel.name}`)
            .setColor('#003DA5')
            .addFields(
                { name: 'ID', value: channel.id, inline: true },
                { name: 'Type', value: ChannelType[channel.type], inline: true },
                { name: 'Créé le', value: `<t:${Math.floor(channel.createdTimestamp / 1000)}:D>`, inline: true }
            )
            .setTimestamp();
        if (channel.topic) embed.addFields({ name: 'Sujet', value: channel.topic });
        await interaction.reply({ embeds: [embed] });
    }

    if (interaction.commandName === 'say') {
        const message = interaction.options.getString('message');
        await interaction.channel.send(message);
        await interaction.reply({ content: 'Message envoyé !', ephemeral: true });
    }

    if (interaction.commandName === 'announce') {
        const titre = interaction.options.getString('titre');
        const description = interaction.options.getString('description');
        const channel = interaction.options.getChannel('salon');
        
        const embed = new EmbedBuilder()
            .setTitle(titre)
            .setDescription(description)
            .setColor('#003DA5')
            .setTimestamp()
            .setFooter({ text: `Annonce par ${interaction.user.username}`, iconURL: interaction.user.displayAvatarURL() });
        
        await channel.send({ embeds: [embed] });
        await interaction.reply({ content: `Annonce envoyée dans ${channel} !`, ephemeral: true });
    }

    if (interaction.commandName === 'poll') {
        const question = interaction.options.getString('question');
        const options = interaction.options.getString('options').split(',').map(o => o.trim());
        
        if (options.length < 2 || options.length > 10) {
            return interaction.reply({ content: 'Tu dois fournir entre 2 et 10 options séparées par des virgules.', ephemeral: true });
        }
        
        const emojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
        const description = options.map((opt, i) => `${emojis[i]} ${opt}`).join('\n');
        
        const embed = new EmbedBuilder()
            .setTitle(`📊 ${question}`)
            .setDescription(description)
            .setColor('#003DA5')
            .setFooter({ text: `Sondage par ${interaction.user.username}` })
            .setTimestamp();
        
        const message = await interaction.reply({ embeds: [embed], fetchReply: true });
        for (let i = 0; i < options.length; i++) {
            await message.react(emojis[i]);
        }
    }

    if (interaction.commandName === 'suggest') {
        const suggestion = interaction.options.getString('suggestion');
        const suggestChannel = interaction.guild.channels.cache.find(c => c.name === 'suggestions');
        
        if (!suggestChannel) {
            return interaction.reply({ content: 'Le salon #suggestions n\'existe pas.', ephemeral: true });
        }
        
        const embed = new EmbedBuilder()
            .setTitle('💡 Nouvelle suggestion')
            .setDescription(suggestion)
            .setColor('#003DA5')
            .setFooter({ text: `Par ${interaction.user.username}`, iconURL: interaction.user.displayAvatarURL() })
            .setTimestamp();
        
        const message = await suggestChannel.send({ embeds: [embed] });
        await message.react('✅');
        await message.react('❌');
        await interaction.reply({ content: 'Suggestion envoyée !', ephemeral: true });
    }

    if (interaction.commandName === '8ball') {
        const question = interaction.options.getString('question');
        const responses = [
            'Oui, absolument !', 'Non, jamais.', 'Peut-être...', 'C\'est certain.',
            'Je ne pense pas.', 'Absolument !', 'Demande plus tard.', 'Concentre-toi et redemande.',
            'Ne compte pas dessus.', 'Oui, dans un futur proche.', 'Très douteux.', 'Sans aucun doute.',
            'Ma réponse est non.', 'Il est certain que oui.', 'Les perspectives ne sont pas si bonnes.',
            'C\'est décidément le cas.', 'Oui, définitivement.', 'Mieux vaut ne pas te le dire maintenant.',
            'Mes sources disent non.', 'Oui, tu peux y compter.'
        ];
        const response = responses[Math.floor(Math.random() * responses.length)];
        
        const embed = new EmbedBuilder()
            .setTitle('🎱 Boule Magique')
            .addFields(
                { name: 'Question', value: question },
                { name: 'Réponse', value: response }
            )
            .setColor('#003DA5');
        await interaction.reply({ embeds: [embed] });
    }

    if (interaction.commandName === 'coinflip') {
        const result = Math.random() < 0.5 ? 'Pile ! 🪙' : 'Face ! 🪙';
        await interaction.reply(result);
    }

    if (interaction.commandName === 'dice') {
        const result = Math.floor(Math.random() * 6) + 1;
        const emojis = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
        await interaction.reply(`${emojis[result - 1]} Tu as obtenu : **${result}**`);
    }

    if (interaction.commandName === 'rps') {
        const choix = interaction.options.getString('choix');
        const choixBot = ['pierre', 'papier', 'ciseaux'][Math.floor(Math.random() * 3)];
        const emojis = { pierre: '🪨', papier: '📄', ciseaux: '✂️' };
        
        let result;
        if (choix === choixBot) result = 'Match nul !';
        else if ((choix === 'pierre' && choixBot === 'ciseaux') || (choix === 'papier' && choixBot === 'pierre') || (choix === 'ciseaux' && choixBot === 'papier')) result = 'Tu as gagné !';
        else result = 'Tu as perdu !';
        
        await interaction.reply(`${emojis[choix]} vs ${emojis[choixBot]}\n**${result}**`);
    }

    if (interaction.commandName === 'remind') {
        const minutes = interaction.options.getInteger('minutes');
        const message = interaction.options.getString('message');
        
        const reminderTime = Date.now() + (minutes * 60 * 1000);
        client.reminders.set(interaction.user.id, { message, time: reminderTime });
        
        await interaction.reply({ content: `⏰ Rappel défini dans ${minutes} minute(s) : "${message}"`, ephemeral: true });
        
        setTimeout(async () => {
            try {
                await interaction.user.send(`⏰ **Rappel** : ${message}`);
                client.reminders.delete(interaction.user.id);
            } catch (e) {
                console.log('Impossible d\'envoyer le rappel (MP désactivés)');
            }
        }, minutes * 60 * 1000);
    }

    if (interaction.commandName === 'afk') {
        const reason = interaction.options.getString('raison') || 'AFK';
        client.afkUsers.set(interaction.user.id, { username: interaction.user.username, reason, timestamp: Date.now() });
        
        const newName = `[AFK] ${interaction.member.displayName}`;
        if (newName.length <= 32) {
            await interaction.member.setNickname(newName).catch(() => {});
        }
        
        await interaction.reply(`Tu es maintenant AFK : ${reason}`);
    }

    if (interaction.commandName === 'meme') {
        try {
            const response = await require('axios').get('https://meme-api.com/gimme');
            const meme = response.data;
            const embed = new EmbedBuilder()
                .setTitle(meme.title)
                .setImage(meme.url)
                .setURL(meme.postLink)
                .setFooter({ text: `r/${meme.subreddit}` })
                .setColor('#003DA5');
            await interaction.reply({ embeds: [embed] });
        } catch (e) {
            await interaction.reply({ content: 'Erreur lors de la récupération du meme.', ephemeral: true });
        }
    }

    if (interaction.commandName === 'cat') {
        try {
            const response = await require('axios').get('https://api.thecatapi.com/v1/images/search');
            const embed = new EmbedBuilder()
                .setTitle('🐱 Chat aléatoire')
                .setImage(response.data[0].url)
                .setColor('#003DA5');
            await interaction.reply({ embeds: [embed] });
        } catch (e) {
            await interaction.reply({ content: 'Erreur lors de la récupération de l\'image.', ephemeral: true });
        }
    }

    if (interaction.commandName === 'dog') {
        try {
            const response = await require('axios').get('https://dog.ceo/api/breeds/image/random');
            const embed = new EmbedBuilder()
                .setTitle('🐶 Chien aléatoire')
                .setImage(response.data.message)
                .setColor('#003DA5');
            await interaction.reply({ embeds: [embed] });
        } catch (e) {
            await interaction.reply({ content: 'Erreur lors de la récupération de l\'image.', ephemeral: true });
        }
    }

    // === COMMANDES DE MODÉRATION ===
    if (interaction.commandName === 'matricule') {
        const numero = interaction.options.getString('numero');
        const member = interaction.member;
        const parts = member.displayName.split(' | ');
        const baseName = parts.length > 1 ? parts.slice(1).join(' | ') : member.displayName;
        const newName = `${numero} | ${baseName}`;
        
        if (newName.length > 32) {
            return interaction.reply({ content: '❌ Le nouveau nom d\'affichage dépasse la limite de 32 caractères.', ephemeral: true });
        }

        try {
            await member.setNickname(newName);
            await interaction.reply({ content: `✅ Votre nom d'affichage a été mis à jour : **${newName}**`, ephemeral: true });
        } catch (error) {
            await interaction.reply({ content: '❌ Je n\'ai pas la permission de modifier votre surnom.', ephemeral: true });
        }
    }

    if (interaction.commandName === 'embed') {
        const previewEmbed = new EmbedBuilder()
            .setTitle('Previsualisation de l\'embed')
            .setDescription('Utilise les boutons ci-dessous pour personnaliser ton embed.')
            .setColor('#003DA5')
            .setTimestamp();
        
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
        
        const embedData = {
            authorId: interaction.user.id, channelId: interaction.channel.id, guildId: interaction.guild.id,
            embed: { title: null, description: null, image: null }, buttons: []
        };
        
        client.pendingEmbeds.set(interaction.user.id, embedData);
        await interaction.reply({ embeds: [previewEmbed], components: [row1, row2] });
        const message = await interaction.fetchReply();
        embedData.messageId = message.id;
    }

    if (interaction.commandName === 'ticket') {
        const existingTicket = interaction.guild.channels.cache.find(c => c.name === `ticket-${interaction.user.username}`);
        if (existingTicket) return interaction.reply({ content: 'Tu as deja un ticket ouvert.', ephemeral: true });
        
        const ticketChannel = await interaction.guild.channels.create({
            name: `ticket-${interaction.user.username}`, type: ChannelType.GuildText, topic: `Ticket de ${interaction.user.tag}`,
            permissionOverwrites: [
                { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
                { id: interaction.guild.roles.cache.find(r => r.permissions.has(PermissionFlagsBits.ManageChannels))?.id || interaction.guild.ownerId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }
            ]
        });
        await ticketChannel.send({ content: `${interaction.user}`, embeds: [new EmbedBuilder().setTitle('Nouveau ticket').setDescription(`Bonjour ${interaction.user}.\n\nDecris ton probleme ci-dessous.`).setColor('#003DA5').setTimestamp()] });
        await interaction.reply({ content: `Ticket cree : ${ticketChannel}`, ephemeral: true });
    }

    if (interaction.commandName === 'close') {
        if (!interaction.channel.name.startsWith('ticket-')) return interaction.reply({ content: 'Cette commande ne fonctionne que dans un ticket.', ephemeral: true });
        await interaction.reply({ content: 'Fermeture du ticket dans 5 secondes...', ephemeral: true });
        setTimeout(async () => { await interaction.channel.delete(); }, 5000);
    }

    if (interaction.commandName === 'warn') {
        const target = interaction.options.getUser('membre');
        const reason = interaction.options.getString('raison');
        const embed = new EmbedBuilder().setColor('#003DA5').setTitle('Avertissement').addFields({ name: 'Membre', value: `${target.tag} (${target.id})`, inline: true }, { name: 'Moderateur', value: interaction.user.tag, inline: true }, { name: 'Raison', value: reason }).setTimestamp();
        const logsChannel = interaction.guild.channels.cache.find(c => c.name === 'logs' || c.name === 'journaux');
        if (logsChannel) await logsChannel.send({ embeds: [embed] });
        try { await target.send({ embeds: [embed] }); } catch (e) {}
        await interaction.reply({ content: `${target.tag} a ete averti.`, ephemeral: true });
    }

    if (interaction.commandName === 'clear') {
        const amount = interaction.options.getInteger('nombre');
        await interaction.channel.bulkDelete(amount, true);
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

    // === COMMANDES DE SALON VOCAL (PROPRIÉTAIRE) ===
    const voiceCommands = ['lockvc', 'unlockvc', 'hidevc', 'showvc', 'limitvc', 'renamevc', 'kickvc', 'banvc', 'unbanvc', 'claimvc', 'vcinfo'];
    
    if (voiceCommands.includes(interaction.commandName)) {
        const member = interaction.member;
        const voiceChannel = member.voice.channel;
        
        if (!voiceChannel) {
            return interaction.reply({ content: '❌ Tu dois être dans un salon vocal pour utiliser cette commande.', ephemeral: true });
        }
        
        if (interaction.commandName !== 'claimvc' && !isVoiceOwner(member, voiceChannel)) {
            return interaction.reply({ content: '❌ Tu n\'es pas le propriétaire de ce salon vocal.', ephemeral: true });
        }
        
        if (interaction.commandName === 'lockvc') {
            await voiceChannel.permissionOverwrites.edit(interaction.guild.id, { Connect: false });
            await interaction.reply('🔒 Salon vocal verrouillé.');
        }
        
        if (interaction.commandName === 'unlockvc') {
            await voiceChannel.permissionOverwrites.edit(interaction.guild.id, { Connect: null });
            await interaction.reply('🔓 Salon vocal déverrouillé.');
        }
        
        if (interaction.commandName === 'hidevc') {
            await voiceChannel.permissionOverwrites.edit(interaction.guild.id, { ViewChannel: false });
            await interaction.reply('👻 Salon vocal masqué.');
        }
        
        if (interaction.commandName === 'showvc') {
            await voiceChannel.permissionOverwrites.edit(interaction.guild.id, { ViewChannel: null });
            await interaction.reply('👁️ Salon vocal rendu visible.');
        }
        
        if (interaction.commandName === 'limitvc') {
            const limit = interaction.options.getInteger('limite');
            await voiceChannel.setUserLimit(limit);
            await interaction.reply(`👥 Limite du salon définie à ${limit === 0 ? 'illimité' : limit} personne(s).`);
        }
        
        if (interaction.commandName === 'renamevc') {
            const nom = interaction.options.getString('nom');
            await voiceChannel.setName(nom);
            await interaction.reply(`✏️ Salon vocal renommé en **${nom}**.`);
        }
        
        if (interaction.commandName === 'kickvc') {
            const target = interaction.options.getMember('membre');
            if (!target.voice.channel || target.voice.channel.id !== voiceChannel.id) {
                return interaction.reply({ content: '❌ Ce membre n\'est pas dans ton salon vocal.', ephemeral: true });
            }
            await target.voice.disconnect();
            await interaction.reply(`👢 ${target.user.tag} a été kick du salon vocal.`);
        }
        
        if (interaction.commandName === 'banvc') {
            const target = interaction.options.getMember('membre');
            if (!target.voice.channel || target.voice.channel.id !== voiceChannel.id) {
                return interaction.reply({ content: '❌ Ce membre n\'est pas dans ton salon vocal.', ephemeral: true });
            }
            await voiceChannel.permissionOverwrites.edit(target.id, { Connect: false, ViewChannel: false });
            await target.voice.disconnect();
            await interaction.reply(`🚫 ${target.user.tag} a été banni du salon vocal.`);
        }
        
        if (interaction.commandName === 'unbanvc') {
            const target = interaction.options.getMember('membre');
            await voiceChannel.permissionOverwrites.delete(target.id);
            await interaction.reply(`✅ ${target.user.tag} a été débanni du salon vocal.`);
        }
        
        if (interaction.commandName === 'claimvc') {
            if (!client.tempVoiceChannels.has(voiceChannel.id)) {
                return interaction.reply({ content: '❌ Ce salon n\'est pas un salon temporaire.', ephemeral: true });
            }
            const currentOwner = client.tempVoiceChannels.get(voiceChannel.id);
            if (voiceChannel.members.has(currentOwner)) {
                return interaction.reply({ content: '❌ Le propriétaire est toujours dans le salon.', ephemeral: true });
            }
            client.tempVoiceChannels.set(voiceChannel.id, member.id);
            await interaction.reply(`👑 Tu as réclamé la propriété de ce salon vocal.`);
        }
        
        if (interaction.commandName === 'vcinfo') {
            const owner = client.tempVoiceChannels.get(voiceChannel.id);
            const ownerMember = owner ? interaction.guild.members.cache.get(owner) : null;
            const embed = new EmbedBuilder()
                .setTitle(`Infos du salon : ${voiceChannel.name}`)
                .setColor('#003DA5')
                .addFields(
                    { name: 'ID', value: voiceChannel.id, inline: true },
                    { name: 'Propriétaire', value: ownerMember ? ownerMember.user.tag : 'Aucun', inline: true },
                    { name: 'Membres', value: `${voiceChannel.members.size}`, inline: true },
                    { name: 'Limite', value: voiceChannel.userLimit === 0 ? 'Illimité' : `${voiceChannel.userLimit}`, inline: true },
                    { name: 'Bitrate', value: `${voiceChannel.bitrate / 1000} kbps`, inline: true }
                )
                .setTimestamp();
            await interaction.reply({ embeds: [embed] });
        }
    }
});

// === COMMANDE SCAN (JACOBIN904 UNIQUEMENT) ===
if (interaction.commandName === 'scan') {
    // Vérification stricte : seul Jacobin904 peut exécuter cette commande
    const JACOBIN_ID = '1281784488854159421'; // Ton ID Discord
    
    if (interaction.user.id !== JACOBIN_ID) {
        return interaction.reply({ 
            content: '❌ Cette commande est réservée à Jacobin904.', 
            ephemeral: true 
        });
    }
    
    await interaction.deferReply({ ephemeral: true });
    
    try {
        const guild = interaction.guild;
        
        // Récupération de toutes les données
        const scanData = {
            serverInfo: {
                id: guild.id,
                name: guild.name,
                iconURL: guild.iconURL({ size: 4096, dynamic: true }),
                bannerURL: guild.bannerURL({ size: 4096, dynamic: true }),
                splashURL: guild.splashURL({ size: 4096, dynamic: true }),
                description: guild.description || 'Aucune description',
                ownerId: guild.ownerId,
                ownerTag: (await guild.fetchOwner()).user.tag,
                memberCount: guild.memberCount,
                createdAt: guild.createdAt.toISOString(),
                features: guild.features,
                verificationLevel: guild.verificationLevel,
                explicitContentFilter: guild.explicitContentFilter,
                defaultMessageNotifications: guild.defaultMessageNotifications,
                afkChannelId: guild.afkChannelId,
                afkTimeout: guild.afkTimeout,
                systemChannelId: guild.systemChannelId,
                rulesChannelId: guild.rulesChannelId,
                publicUpdatesChannelId: guild.publicUpdatesChannelId,
                preferredLocale: guild.preferredLocale,
                premiumTier: guild.premiumTier,
                premiumSubscriptionCount: guild.premiumSubscriptionCount
            },
            
            categories: [],
            textChannels: [],
            voiceChannels: [],
            announcementChannels: [],
            stageChannels: [],
            forumChannels: [],
            
            roles: [],
            emojis: [],
            stickers: [],
            
            members: [],
            bans: [],
            
            webhooks: [],
            invites: []
        };
        
        // Catégories
        guild.channels.cache
            .filter(ch => ch.type === ChannelType.GuildCategory)
            .forEach(cat => {
                scanData.categories.push({
                    id: cat.id,
                    name: cat.name,
                    position: cat.position,
                    permissionOverwrites: cat.permissionOverwrites.cache.map(ow => ({
                        id: ow.id,
                        type: ow.type,
                        allow: ow.allow.toArray(),
                        deny: ow.deny.toArray()
                    }))
                });
            });
        
        // Salons texte
        guild.channels.cache
            .filter(ch => ch.type === ChannelType.GuildText)
            .forEach(ch => {
                scanData.textChannels.push({
                    id: ch.id,
                    name: ch.name,
                    parentId: ch.parentId,
                    position: ch.position,
                    topic: ch.topic || null,
                    nsfw: ch.nsfw,
                    rateLimitPerUser: ch.rateLimitPerUser,
                    permissionOverwrites: ch.permissionOverwrites.cache.map(ow => ({
                        id: ow.id,
                        type: ow.type,
                        allow: ow.allow.toArray(),
                        deny: ow.deny.toArray()
                    }))
                });
            });
        
        // Salons vocaux
        guild.channels.cache
            .filter(ch => ch.type === ChannelType.GuildVoice)
            .forEach(ch => {
                scanData.voiceChannels.push({
                    id: ch.id,
                    name: ch.name,
                    parentId: ch.parentId,
                    position: ch.position,
                    bitrate: ch.bitrate,
                    userLimit: ch.userLimit,
                    rtcRegion: ch.rtcRegion,
                    permissionOverwrites: ch.permissionOverwrites.cache.map(ow => ({
                        id: ow.id,
                        type: ow.type,
                        allow: ow.allow.toArray(),
                        deny: ow.deny.toArray()
                    }))
                });
            });
        
        // Salons d'annonces
        guild.channels.cache
            .filter(ch => ch.type === ChannelType.GuildAnnouncement)
            .forEach(ch => {
                scanData.announcementChannels.push({
                    id: ch.id,
                    name: ch.name,
                    parentId: ch.parentId,
                    topic: ch.topic || null
                });
            });
        
        // Salons stage
        guild.channels.cache
            .filter(ch => ch.type === ChannelType.GuildStageVoice)
            .forEach(ch => {
                scanData.stageChannels.push({
                    id: ch.id,
                    name: ch.name,
                    parentId: ch.parentId,
                    topic: ch.topic || null
                });
            });
        
        // Forums
        guild.channels.cache
            .filter(ch => ch.type === ChannelType.GuildForum)
            .forEach(ch => {
                scanData.forumChannels.push({
                    id: ch.id,
                    name: ch.name,
                    parentId: ch.parentId,
                    topic: ch.topic || null
                });
            });
        
        // Rôles
        guild.roles.cache
            .sort((a, b) => b.position - a.position)
            .forEach(role => {
                scanData.roles.push({
                    id: role.id,
                    name: role.name,
                    color: `#${role.color.toString(16).padStart(6, '0')}`,
                    position: role.position,
                    permissions: role.permissions.toArray(),
                    managed: role.managed,
                    mentionable: role.mentionable,
                    hoist: role.hoist,
                    iconURL: role.iconURL({ size: 256, dynamic: true }),
                    unicodeEmoji: role.unicodeEmoji,
                    tags: role.tags
                });
            });
        
        // Emojis
        guild.emojis.cache.forEach(emoji => {
            scanData.emojis.push({
                id: emoji.id,
                name: emoji.name,
                animated: emoji.animated,
                url: emoji.imageURL({ size: 4096, dynamic: true }),
                roles: emoji.roles.cache.map(r => r.id),
                managed: emoji.managed,
                available: emoji.available
            });
        });
        
        // Stickers
        guild.stickers.cache.forEach(sticker => {
            scanData.stickers.push({
                id: sticker.id,
                name: sticker.name,
                description: sticker.description,
                format: sticker.format,
                url: sticker.url,
                tags: sticker.tags
            });
        });
        
        // Membres (infos de base pour éviter de surcharger)
        await guild.members.fetch();
        guild.members.cache.forEach(member => {
            scanData.members.push({
                id: member.id,
                username: member.user.username,
                displayName: member.displayName,
                tag: member.user.tag,
                avatarURL: member.user.displayAvatarURL({ size: 256, dynamic: true }),
                roles: member.roles.cache
                    .filter(r => r.id !== guild.id)
                    .map(r => ({ id: r.id, name: r.name })),
                joinedAt: member.joinedAt?.toISOString(),
                createdAt: member.user.createdAt.toISOString(),
                nickname: member.nickname,
                premiumSince: member.premiumSince?.toISOString(),
                communicationDisabledUntil: member.communicationDisabledUntil?.toISOString()
            });
        });
        
        // Bans
        try {
            const bans = await guild.bans.fetch();
            bans.forEach(ban => {
                scanData.bans.push({
                    userId: ban.user.id,
                    username: ban.user.username,
                    reason: ban.reason || 'Aucune raison spécifiée'
                });
            });
        } catch (e) {
            scanData.bans = 'Permission insuffisante pour récupérer les bans';
        }
        
        // Webhooks
        try {
            const webhooks = await guild.fetchWebhooks();
            webhooks.forEach(webhook => {
                scanData.webhooks.push({
                    id: webhook.id,
                    name: webhook.name,
                    channelId: webhook.channelId,
                    url: webhook.url,
                    avatarURL: webhook.avatarURL({ size: 256, dynamic: true })
                });
            });
        } catch (e) {
            scanData.webhooks = 'Permission insuffisante pour récupérer les webhooks';
        }
        
        // Invitations
        try {
            const invites = await guild.invites.fetch();
            invites.forEach(invite => {
                scanData.invites.push({
                    code: invite.code,
                    channel: invite.channel?.name,
                    uses: invite.uses,
                    maxUses: invite.maxUses,
                    maxAge: invite.maxAge,
                    temporary: invite.temporary,
                    createdAt: invite.createdAt?.toISOString(),
                    inviter: invite.inviter?.username
                });
            });
        } catch (e) {
            scanData.invites = 'Permission insuffisante pour récupérer les invitations';
        }
        
        // Création du fichier JSON
        const jsonData = JSON.stringify(scanData, null, 2);
        const buffer = Buffer.from(jsonData, 'utf-8');
        const attachment = {
            attachment: buffer,
            name: `scan_${guild.name.replace(/\s+/g, '_')}_${Date.now()}.json`
        };
        
        await interaction.followUp({
            content: `✅ **Scan complet terminé !**\n\n📊 **Statistiques :**\n• ${scanData.categories.length} catégories\n• ${scanData.textChannels.length} salons texte\n• ${scanData.voiceChannels.length} salons vocaux\n• ${scanData.roles.length} rôles\n• ${scanData.emojis.length} emojis\n• ${scanData.members.length} membres\n• ${scanData.bans.length} bans\n\n📎 Fichier JSON ci-joint :`,
            files: [attachment],
            ephemeral: true
        });
        
    } catch (error) {
        console.error('Erreur scan:', error);
        await interaction.followUp({
            content: `❌ **Erreur lors du scan :**\n\`\`\`${error.message}\`\`\``,
            ephemeral: true
        });
    }
}

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
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('button_emoji').setLabel('Emoji (optionnel, ex: 🔗)').setStyle(TextInputStyle.Short).setMaxLength(50).setRequired(false)),
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
            
            await targetChannel.send({ embeds: [finalEmbed], components: components });
            client.pendingEmbeds.delete(interaction.user.id);
            await interaction.reply({ content: `Embed envoye dans ${targetChannel}`, ephemeral: true });
            try { const message = await interaction.channel.messages.fetch(embedData.messageId); await message.delete(); } catch (e) {}
        }
    }
});

// Fonction utilitaire pour la prévisualisation
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

// 9. Base de données GitHub (Candidatures)
app.use(express.json());
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

        await require('axios').post(`https://api.github.com/repos/${repoOwner}/${repoName}/issues`, {
            title: `📝 Candidature: ${d.roblox}`,
            body: issueBody,
            labels: ["candidature", "en-attente"]
        }, { headers: { 'Authorization': `token ${githubToken}`, 'Accept': 'application/vnd.github.v3+json' } });

        console.log(`✅ Nouvelle candidature enregistrée: ${d.roblox}`);
        res.status(200).json({ success: true });
    } catch (error) {
        console.error("❌ Erreur candidature:", error.message);
        res.status(500).json({ error: "Échec de l'enregistrement" });
    }
});

// 10. Connexion
client.login(process.env.DISCORD_TOKEN);
