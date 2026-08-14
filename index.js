require('dotenv').config();
const express = require('express');
const { 
    Client, GatewayIntentBits, EmbedBuilder, SlashCommandBuilder, 
    REST, Routes, ChannelType, PermissionFlagsBits, 
    ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, 
    TextInputBuilder, TextInputStyle
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
        GatewayIntentBits.GuildVoiceStates // NÉCESSAIRE pour les salons vocaux
    ] 
});

// Stockage des embeds et des salons vocaux temporaires
client.pendingEmbeds = new Map();
client.tempVoiceChannels = new Map(); // Stocke: channelId -> ownerId

// ID du salon "Créer ton vocal"
const JOIN_CHANNEL_ID = '1490445738163830815';

// 3. Commandes Slash
const commands = [
    new SlashCommandBuilder().setName('ping').setDescription('Vérifie la latence du bot.'),
    new SlashCommandBuilder().setName('embed').setDescription('Crée un embed interactif avec previsualisation.'),
    new SlashCommandBuilder().setName('ticket').setDescription('Ouvre un ticket de support.'),
    new SlashCommandBuilder().setName('close').setDescription('Ferme le ticket actuel.').setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
    new SlashCommandBuilder().setName('warn').setDescription('Avertir un membre.')
        .addUserOption(option => option.setName('membre').setDescription('Le membre a avertir').setRequired(true))
        .addStringOption(option => option.setName('raison').setDescription('Raison de l\'avertissement').setRequired(true)),
    new SlashCommandBuilder().setName('clear').setDescription('Supprime des messages.')
        .addIntegerOption(option => option.setName('nombre').setDescription('Nombre de messages a supprimer (max 100)').setRequired(true).setMinValue(1).setMaxValue(100)),
    new SlashCommandBuilder().setName('userinfo').setDescription('Affiche les informations d\'un utilisateur.')
        .addUserOption(option => option.setName('membre').setDescription('Le membre dont voir les infos')),
    new SlashCommandBuilder().setName('serverinfo').setDescription('Affiche les informations du serveur.'),
    
    // NOUVELLE COMMANDE : MATRICULE
    new SlashCommandBuilder()
        .setName('matricule')
        .setDescription('Définit ou met à jour votre matricule dans votre nom d\'affichage.')
        .addStringOption(option => 
            option.setName('numero')
                  .setDescription('Votre numéro de matricule (ex: 12-43)')
                  .setRequired(true)
        )
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

// 5. Système de logs (Join/Leave/Delete)
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

// ============================================================
// 6. NOUVEAU : Système de Salon Vocal Temporaire (Join-to-Create)
// ============================================================
client.on('voiceStateUpdate', async (oldState, newState) => {
    const member = newState.member;
    if (!member) return;

    // Si le membre rejoint le salon "Créer ton vocal"
    if (newState.channelId === JOIN_CHANNEL_ID && oldState.channelId !== JOIN_CHANNEL_ID) {
        try {
            const category = newState.channel.parentId;
            const displayName = member.displayName; // Nom d'affichage Discord
            
            // Créer le nouveau salon
            const newChannel = await newState.guild.channels.create({
                name: `Vocal ${displayName}`,
                type: ChannelType.GuildVoice,
                parent: category,
                permissionOverwrites: [
                    {
                        id: newState.guild.id, // @everyone
                        deny: [PermissionFlagsBits.Connect] // Optionnel : empêche les autres de se connecter si tu veux un salon privé
                    },
                    {
                        id: member.id, // Le propriétaire
                        allow: [
                            PermissionFlagsBits.Connect,
                            PermissionFlagsBits.ManageChannels,
                            PermissionFlagsBits.MoveMembers,
                            PermissionFlagsBits.MuteMembers,
                            PermissionFlagsBits.DeafenMembers
                        ]
                    }
                ]
            });

            // Déplacer le membre dans son nouveau salon
            await member.voice.setChannel(newChannel);
            
            // Enregistrer le propriétaire
            client.tempVoiceChannels.set(newChannel.id, member.id);
            
        } catch (error) {
            console.error('Erreur création salon vocal:', error);
        }
    }

    // Nettoyage : Si quelqu'un quitte un salon temporaire et qu'il est vide, on le supprime
    if (oldState.channelId && client.tempVoiceChannels.has(oldState.channelId)) {
        const channel = oldState.channel;
        if (channel && channel.members.size === 0) {
            await channel.delete().catch(console.error);
            client.tempVoiceChannels.delete(oldState.channelId);
        }
    }
});

// ============================================================
// 7. Gestion des commandes Slash
// ============================================================
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'ping') {
        await interaction.reply(`Pong ! Latence : ${client.ws.ping}ms`);
    }

    // === COMMANDE MATRICULE ===
    if (interaction.commandName === 'matricule') {
        const numero = interaction.options.getString('numero');
        const member = interaction.member;
        
        // Récupérer le nom de base (sans l'ancien matricule s'il y en a un)
        // Ex: "12-43 | Jacobin904" -> on garde "Jacobin904"
        const parts = member.displayName.split(' | ');
        const baseName = parts.length > 1 ? parts.slice(1).join(' | ') : member.displayName;
        
        const newName = `${numero} | ${baseName}`;
        
        // Vérifier la limite de 32 caractères de Discord
        if (newName.length > 32) {
            return interaction.reply({ content: '❌ Le nouveau nom d\'affichage dépasse la limite de 32 caractères. Veuillez utiliser un numéro plus court.', ephemeral: true });
        }

        try {
            await member.setNickname(newName);
            await interaction.reply({ content: `✅ Votre nom d'affichage a été mis à jour : **${newName}**`, ephemeral: true });
        } catch (error) {
            console.error(error);
            await interaction.reply({ content: '❌ Je n\'ai pas la permission de modifier votre surnom. Vérifiez que mes rôles sont au-dessus des vôtres.', ephemeral: true });
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
});

// ============================================================
// 8. Gestion des boutons et modals (Embed)
// ============================================================
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
            
            // Résolution intelligente des emojis personnalisés du serveur
            let resolvedEmoji = rawEmoji;
            if (rawEmoji && /^:\w+:$/.test(rawEmoji)) {
                const emojiName = rawEmoji.slice(1, -1).toLowerCase();
                const customEmoji = interaction.guild.emojis.cache.find(e => e.name.toLowerCase() === emojiName);
                if (customEmoji) resolvedEmoji = customEmoji.id;
                else resolvedEmoji = null; // Ignore si l'emoji n'existe pas pour éviter le crash
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

// ============================================================
// 9. Base de données GitHub (Candidatures)
// ============================================================
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
