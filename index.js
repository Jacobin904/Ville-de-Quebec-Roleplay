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
        GatewayIntentBits.GuildModeration
    ] 
});

// Stockage des embeds en cours de creation
client.pendingEmbeds = new Map();

// CONSTANTES VERROUILLEES (Identite visuelle VQC)
const VQC_LOGO = 'https://cdn.discordapp.com/icons/1490410149213507804/0b1aa46a2fdb33b133a0feb1234739f6.webp?size=1024';
const VQC_FOOTER_TEXT = 'Ville de Quebec Roleplay (VQC)';
const VQC_COLOR = '#003DA5'; // Couleur verrouillee

// 3. Commandes Slash
const commands = [
    new SlashCommandBuilder().setName('ping').setDescription('Verifie la latence du bot.'),
    new SlashCommandBuilder().setName('embed').setDescription('Cree un embed interactif avec previsualisation.'),
    new SlashCommandBuilder().setName('ticket').setDescription('Ouvre un ticket de support.'),
    new SlashCommandBuilder().setName('close').setDescription('Ferme le ticket actuel.').setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
    new SlashCommandBuilder().setName('warn').setDescription('Avertir un membre.')
        .addUserOption(option => option.setName('membre').setDescription('Le membre a avertir').setRequired(true))
        .addStringOption(option => option.setName('raison').setDescription('Raison de l\'avertissement').setRequired(true)),
    new SlashCommandBuilder().setName('clear').setDescription('Supprime des messages.')
        .addIntegerOption(option => option.setName('nombre').setDescription('Nombre de messages a supprimer (max 100)').setRequired(true).setMinValue(1).setMaxValue(100)),
    new SlashCommandBuilder().setName('userinfo').setDescription('Affiche les informations d\'un utilisateur.')
        .addUserOption(option => option.setName('membre').setDescription('Le membre dont voir les infos')),
    new SlashCommandBuilder().setName('serverinfo').setDescription('Affiche les informations du serveur.')
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

// 5. Systeme de logs (SANS EMOJIS)
client.on('guildMemberAdd', async member => {
    const logsChannel = member.guild.channels.cache.find(c => c.name === 'logs' || c.name === 'journaux');
    if (!logsChannel) return;
    await logsChannel.send({ embeds: [new EmbedBuilder().setColor(VQC_COLOR).setTitle('Nouveau membre').addFields({ name: 'Membre', value: `${member.user.tag} (${member.id})`, inline: true }, { name: 'Compte cree', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, inline: true }).setThumbnail(member.user.displayAvatarURL()).setFooter({ text: VQC_FOOTER_TEXT, iconURL: VQC_LOGO }).setTimestamp()] });
});

client.on('guildMemberRemove', async member => {
    const logsChannel = member.guild.channels.cache.find(c => c.name === 'logs' || c.name === 'journaux');
    if (!logsChannel) return;
    await logsChannel.send({ embeds: [new EmbedBuilder().setColor(VQC_COLOR).setTitle('Membre parti').addFields({ name: 'Membre', value: `${member.user.tag} (${member.id})`, inline: true }, { name: 'A rejoint le', value: member.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:D>` : 'Inconnu', inline: true }).setThumbnail(member.user.displayAvatarURL()).setFooter({ text: VQC_FOOTER_TEXT, iconURL: VQC_LOGO }).setTimestamp()] });
});

client.on('messageDelete', async message => {
    if (!message.author || message.author.bot) return;
    const logsChannel = message.guild.channels.cache.find(c => c.name === 'logs' || c.name === 'journaux');
    if (!logsChannel) return;
    await logsChannel.send({ embeds: [new EmbedBuilder().setColor(VQC_COLOR).setTitle('Message supprime').addFields({ name: 'Auteur', value: `${message.author.tag} (${message.author.id})`, inline: true }, { name: 'Canal', value: `<#${message.channel.id}>`, inline: true }, { name: 'Contenu', value: message.content.substring(0, 1000) || 'Message sans texte' }).setFooter({ text: VQC_FOOTER_TEXT, iconURL: VQC_LOGO }).setTimestamp()] });
});

// 6. Commande /embed - Creation de la previsualisation
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'ping') {
        await interaction.reply(`Pong ! Latence : ${client.ws.ping}ms`);
    }

    if (interaction.commandName === 'embed') {
        const previewEmbed = new EmbedBuilder()
            .setTitle('Previsualisation de l\'embed')
            .setDescription('Utilise les boutons ci-dessous pour personnaliser ton embed.\n\nLe footer, la miniature et la couleur sont verrouilles sur l\'identite de VQC.')
            .setColor(VQC_COLOR)
            .setFooter({ text: VQC_FOOTER_TEXT, iconURL: VQC_LOGO })
            .setThumbnail(VQC_LOGO)
            .setTimestamp();
        
        // BOUTONS SANS EMOJIS
        const row1 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('edit_title').setLabel('Titre').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('edit_description').setLabel('Description').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('edit_author').setLabel('Auteur').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('edit_image').setLabel('Image').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('edit_author_icon').setLabel('Icone Auteur').setStyle(ButtonStyle.Secondary)
        );
        
        const row2 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('send_embed').setLabel('Envoyer').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('cancel_embed').setLabel('Annuler').setStyle(ButtonStyle.Danger)
        );
        
        const embedData = {
            authorId: interaction.user.id,
            channelId: interaction.channel.id,
            guildId: interaction.guild.id,
            embed: { title: null, description: null, author: null, authorIcon: null, image: null }
        };
        
        client.pendingEmbeds.set(interaction.user.id, embedData);
        const message = await interaction.reply({ embeds: [previewEmbed], components: [row1, row2], fetchReply: true });
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
        await ticketChannel.send({ content: `${interaction.user}`, embeds: [new EmbedBuilder().setTitle('Nouveau ticket').setDescription(`Bonjour ${interaction.user}.\n\nDecris ton probleme ci-dessous. Un membre du staff te repondra.`).setColor(VQC_COLOR).setFooter({ text: VQC_FOOTER_TEXT, iconURL: VQC_LOGO }).setTimestamp()] });
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
        const embed = new EmbedBuilder().setColor(VQC_COLOR).setTitle('Avertissement').addFields({ name: 'Membre', value: `${target.tag} (${target.id})`, inline: true }, { name: 'Moderateur', value: interaction.user.tag, inline: true }, { name: 'Raison', value: reason }).setFooter({ text: VQC_FOOTER_TEXT, iconURL: VQC_LOGO }).setTimestamp();
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
        await interaction.reply({ embeds: [new EmbedBuilder().setTitle(`Informations : ${member.user.username}`).setColor(VQC_COLOR).setThumbnail(member.user.displayAvatarURL({ size: 256 })).addFields({ name: 'Tag', value: member.user.tag, inline: true }, { name: 'ID', value: member.id, inline: true }, { name: 'Compte cree', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:D>`, inline: true }, { name: 'A rejoint', value: member.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:D>` : 'Inconnu', inline: true }, { name: 'Roles', value: member.roles.cache.filter(r => r.id !== member.guild.id).map(r => r.name).join(', ') || 'Aucun', inline: false }).setFooter({ text: VQC_FOOTER_TEXT, iconURL: VQC_LOGO }).setTimestamp()] });
    }

    if (interaction.commandName === 'serverinfo') {
        const guild = interaction.guild;
        await interaction.reply({ embeds: [new EmbedBuilder().setTitle(`Informations du serveur : ${guild.name}`).setColor(VQC_COLOR).setThumbnail(guild.iconURL()).addFields({ name: 'ID', value: guild.id, inline: true }, { name: 'Proprietaire', value: `<@${guild.ownerId}>`, inline: true }, { name: 'Membres', value: `${guild.memberCount}`, inline: true }, { name: 'Salons', value: `${guild.channels.cache.size}`, inline: true }, { name: 'Roles', value: `${guild.roles.cache.size}`, inline: true }, { name: 'Cree le', value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:D>`, inline: false }).setFooter({ text: VQC_FOOTER_TEXT, iconURL: VQC_LOGO }).setTimestamp()] });
    }
});

// 7. Gestion des boutons d'embed
client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;
    
    const embedData = client.pendingEmbeds.get(interaction.user.id);
    if (!embedData) return interaction.reply({ content: 'Aucune previsualisation en cours. Utilise /embed.', ephemeral: true });
    if (interaction.user.id !== embedData.authorId) return interaction.reply({ content: 'Tu ne peux modifier que tes propres embeds.', ephemeral: true });
    
    if (interaction.customId === 'edit_title') {
        const modal = new ModalBuilder().setCustomId('modal_title').setTitle('Modifier le titre');
        modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('title_input').setLabel('Titre').setStyle(TextInputStyle.Short).setPlaceholder('Entre le titre...').setMaxLength(256).setRequired(true)));
        await interaction.showModal(modal);
    }
    if (interaction.customId === 'edit_description') {
        const modal = new ModalBuilder().setCustomId('modal_description').setTitle('Modifier la description');
        modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('description_input').setLabel('Description').setStyle(TextInputStyle.Paragraph).setPlaceholder('Entre la description...').setMaxLength(4000).setRequired(false)));
        await interaction.showModal(modal);
    }
    if (interaction.customId === 'edit_author') {
        const modal = new ModalBuilder().setCustomId('modal_author').setTitle('Modifier l\'auteur');
        modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('author_input').setLabel('Nom de l\'auteur').setStyle(TextInputStyle.Short).setPlaceholder('Nom...').setMaxLength(256).setRequired(true)));
        await interaction.showModal(modal);
    }
    if (interaction.customId === 'edit_image') {
        const modal = new ModalBuilder().setCustomId('modal_image').setTitle('Modifier l\'image');
        modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('image_input').setLabel('URL de l\'image').setStyle(TextInputStyle.Short).setPlaceholder('https://...').setMaxLength(2048).setRequired(true)));
        await interaction.showModal(modal);
    }
    if (interaction.customId === 'edit_author_icon') {
        const modal = new ModalBuilder().setCustomId('modal_author_icon').setTitle('Icone de l\'auteur');
        modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('author_icon_input').setLabel('URL de l\'icone').setStyle(TextInputStyle.Short).setPlaceholder('https://...').setMaxLength(2048).setRequired(true)));
        await interaction.showModal(modal);
    }
    if (interaction.customId === 'send_embed') {
        const modal = new ModalBuilder().setCustomId('modal_send').setTitle('Envoyer l\'embed');
        modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('channel_input').setLabel('ID ou nom du salon').setStyle(TextInputStyle.Short).setPlaceholder('Ex: annonces ou 123456789').setMaxLength(100).setRequired(true)));
        await interaction.showModal(modal);
    }
    if (interaction.customId === 'cancel_embed') {
        client.pendingEmbeds.delete(interaction.user.id);
        await interaction.reply({ content: 'Creation annulee.', ephemeral: true });
        try { const message = await interaction.channel.messages.fetch(embedData.messageId); await message.delete(); } catch (e) {}
    }
});

// 8. Gestion des modals
client.on('interactionCreate', async interaction => {
    if (!interaction.isModalSubmit()) return;
    const embedData = client.pendingEmbeds.get(interaction.user.id);
    if (!embedData) return;
    
    if (interaction.customId === 'modal_title') { embedData.embed.title = interaction.fields.getTextInputValue('title_input'); await updatePreview(interaction, embedData); }
    if (interaction.customId === 'modal_description') { embedData.embed.description = interaction.fields.getTextInputValue('description_input') || null; await updatePreview(interaction, embedData); }
    if (interaction.customId === 'modal_author') { embedData.embed.author = interaction.fields.getTextInputValue('author_input'); await updatePreview(interaction, embedData); }
    if (interaction.customId === 'modal_image') { embedData.embed.image = interaction.fields.getTextInputValue('image_input'); await updatePreview(interaction, embedData); }
    if (interaction.customId === 'modal_author_icon') { embedData.embed.authorIcon = interaction.fields.getTextInputValue('author_icon_input'); await updatePreview(interaction, embedData); }
    
    if (interaction.customId === 'modal_send') {
        const channelInput = interaction.fields.getTextInputValue('channel_input');
        let targetChannel;
        if (channelInput.match(/^\d+$/)) targetChannel = await interaction.client.channels.fetch(channelInput).catch(() => null);
        else targetChannel = interaction.guild.channels.cache.find(c => c.name.toLowerCase() === channelInput.toLowerCase());
        
        if (!targetChannel || !targetChannel.isTextBased()) return interaction.reply({ content: 'Salon introuvable. Verifie l\'ID ou le nom.', ephemeral: true });
        
        const finalEmbed = new EmbedBuilder();
        if (embedData.embed.title) finalEmbed.setTitle(embedData.embed.title);
        if (embedData.embed.description) finalEmbed.setDescription(embedData.embed.description);
        
        // VERROUILLAGE STRICT
        finalEmbed.setColor(VQC_COLOR);
        if (embedData.embed.author) finalEmbed.setAuthor({ name: embedData.embed.author, iconURL: embedData.embed.authorIcon || undefined });
        if (embedData.embed.image) finalEmbed.setImage(embedData.embed.image);
        finalEmbed.setFooter({ text: VQC_FOOTER_TEXT, iconURL: VQC_LOGO });
        finalEmbed.setThumbnail(VQC_LOGO);
        finalEmbed.setTimestamp();
        
        await targetChannel.send({ embeds: [finalEmbed] });
        client.pendingEmbeds.delete(interaction.user.id);
        await interaction.reply({ content: `Embed envoye dans ${targetChannel}`, ephemeral: true });
        
        try { const message = await interaction.channel.messages.fetch(embedData.messageId); await message.delete(); } catch (e) {}
    }
});

// Fonction pour mettre a jour la previsualisation
async function updatePreview(interaction, embedData) {
    const previewEmbed = new EmbedBuilder();
    if (embedData.embed.title) previewEmbed.setTitle(embedData.embed.title);
    if (embedData.embed.description) previewEmbed.setDescription(embedData.embed.description);
    if (embedData.embed.author) previewEmbed.setAuthor({ name: embedData.embed.author, iconURL: embedData.embed.authorIcon || undefined });
    if (embedData.embed.image) previewEmbed.setImage(embedData.embed.image);
    
    // VERROUILLAGE STRICT
    previewEmbed.setColor(VQC_COLOR);
    previewEmbed.setFooter({ text: VQC_FOOTER_TEXT, iconURL: VQC_LOGO });
    previewEmbed.setThumbnail(VQC_LOGO);
    previewEmbed.setTimestamp();
    
    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('edit_title').setLabel('Titre').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('edit_description').setLabel('Description').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('edit_author').setLabel('Auteur').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('edit_image').setLabel('Image').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('edit_author_icon').setLabel('Icone Auteur').setStyle(ButtonStyle.Secondary)
    );
    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('send_embed').setLabel('Envoyer').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('cancel_embed').setLabel('Annuler').setStyle(ButtonStyle.Danger)
    );
    
    try {
        const message = await interaction.channel.messages.fetch(embedData.messageId);
        await message.edit({ embeds: [previewEmbed], components: [row1, row2] });
        await interaction.reply({ content: 'Previsualisation mise a jour', ephemeral: true });
    } catch (e) { await interaction.reply({ content: 'Erreur lors de la mise a jour.', ephemeral: true }); }
}

// 9. Connexion
client.login(process.env.DISCORD_TOKEN);
