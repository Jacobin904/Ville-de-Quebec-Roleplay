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

// CONSTANTES VERROUILLEES
const VQC_LOGO = 'https://cdn.discordapp.com/icons/1490410149213507804/0b1aa46a2fdb33b133a0feb1234739f6.webp?size=1024';
const VQC_FOOTER_TEXT = 'Ville de Quebec Roleplay (VQC)';
const VQC_COLOR = '#003DA5';

// FONCTION POUR RESOUDRE LES EMOJIS (Personnalises ou Unicode)
function resolveEmoji(emojiInput, guild) {
    if (!emojiInput || emojiInput.trim() === '') return null;
    
    // Si c'est deja un ID ou un format d'emoji personnalise complet
    if (/<a?:\w+:\d+>/.test(emojiInput) || /^\d{17,20}$/.test(emojiInput)) {
        return emojiInput;
    }
    
    // Si c'est au format :nom:
    const nameMatch = emojiInput.match(/^:(\w+):$/);
    if (nameMatch && guild) {
        const emojiName = nameMatch[1].toLowerCase();
        const customEmoji = guild.emojis.cache.find(e => e.name.toLowerCase() === emojiName);
        if (customEmoji) {
            return customEmoji.id; // Retourne l'ID que Discord.js accepte
        }
        // Si le format est :nom: mais qu'il n'existe pas, on retourne null pour eviter un crash
        return null; 
    }
    
    // Sinon, on suppose que c'est un emoji unicode standard (🔥, ✅, etc.)
    return emojiInput;
}

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

// 5. Systeme de logs
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

// 6. Commande /embed
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'ping') {
        await interaction.reply(`Pong ! Latence : ${client.ws.ping}ms`);
    }

    if (interaction.commandName === 'embed') {
        const previewEmbed = new EmbedBuilder()
            .setTitle('Previsualisation de l\'embed')
            .setDescription('Utilise les boutons ci-dessous pour personnaliser ton embed.\n\nPour les emojis de bouton, utilise le format :nom: (ex: :feu:) ou un emoji standard.')
            .setColor(VQC_COLOR)
            .setFooter({ text: VQC_FOOTER_TEXT, iconURL: VQC_LOGO })
            .setThumbnail(VQC_LOGO)
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
            authorId: interaction.user.id,
            channelId: interaction.channel.id,
            guildId: interaction.guild.id,
            embed: { title: null, description: null, image: null },
            buttons: []
        };
        
        client.pendingEmbeds.set(interaction.user.id, embedData);
        
        // CORRECTION DE L'AVERTISSEMENT fetchReply
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
        const msg = await interaction.reply({ content: `${amount} messages supprimes.`, ephemeral: true, fetchReply: true }); // fetchReply est encore ok ici car c'est une reponse simple, mais on peut le changer si tu veux
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

// 7. Gestion des boutons
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
    if (interaction.customId === 'edit_image') {
        const modal = new ModalBuilder().setCustomId('modal_image').setTitle('Modifier l\'image');
        modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('image_input').setLabel('URL de l\'image').setStyle(TextInputStyle.Short).setPlaceholder('https://...').setMaxLength(2048).setRequired(true)));
        await interaction.showModal(modal);
    }
    
    if (interaction.customId === 'add_button') {
        if (embedData.buttons.length >= 5) {
            return interaction.reply({ content: 'Maximum 5 boutons par embed atteint.', ephemeral: true });
        }
        const modal = new ModalBuilder().setCustomId('modal_add_button').setTitle('Ajouter un bouton');
        modal.addComponents(
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('button_label').setLabel('Texte du bouton').setStyle(TextInputStyle.Short).setPlaceholder('Ex: Rejoindre le Discord').setMaxLength(80).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('button_emoji').setLabel('Emoji (ex: :feu: ou 🔗)').setStyle(TextInputStyle.Short).setPlaceholder(':nom_de_l_emoji: ou vide').setMaxLength(50).setRequired(false)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('button_url').setLabel('URL du lien').setStyle(TextInputStyle.Short).setPlaceholder('https://...').setMaxLength(2048).setRequired(true))
        );
        await interaction.showModal(modal);
    }
    
    if (interaction.customId === 'remove_button') {
        if (embedData.buttons.length === 0) {
            return interaction.reply({ content: 'Aucun bouton a retirer.', ephemeral: true });
        }
        embedData.buttons.pop();
        await updatePreview(interaction, embedData);
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
    if (interaction.customId === 'modal_image') { embedData.embed.image = interaction.fields.getTextInputValue('image_input'); await updatePreview(interaction, embedData); }
    
    if (interaction.customId === 'modal_add_button') {
        const label = interaction.fields.getTextInputValue('button_label');
        const rawEmoji = interaction.fields.getTextInputValue('button_emoji');
        const url = interaction.fields.getTextInputValue('button_url');
        
        // RESOLUTION DE L'EMOJI ICI
        const resolvedEmoji = resolveEmoji(rawEmoji, interaction.guild);
        
        embedData.buttons.push({ label, emoji: resolvedEmoji, url });
        await updatePreview(interaction, embedData);
    }
    
    if (interaction.customId === 'modal_send') {
        const channelInput = interaction.fields.getTextInputValue('channel_input');
        let targetChannel;
        if (channelInput.match(/^\d+$/)) targetChannel = await interaction.client.channels.fetch(channelInput).catch(() => null);
        else targetChannel = interaction.guild.channels.cache.find(c => c.name.toLowerCase() === channelInput.toLowerCase());
        
        if (!targetChannel || !targetChannel.isTextBased()) return interaction.reply({ content: 'Salon introuvable. Verifie l\'ID ou le nom.', ephemeral: true });
        
        const finalEmbed = new EmbedBuilder();
        if (embedData.embed.title) finalEmbed.setTitle(embedData.embed.title);
        if (embedData.embed.description) finalEmbed.setDescription(embedData.embed.description);
        if (embedData.embed.image) finalEmbed.setImage(embedData.embed.image);
        
        finalEmbed.setColor(VQC_COLOR);
        finalEmbed.setFooter({ text: VQC_FOOTER_TEXT, iconURL: VQC_LOGO });
        finalEmbed.setThumbnail(VQC_LOGO);
        finalEmbed.setTimestamp();
        
        const components = [];
        if (embedData.buttons.length > 0) {
            const buttonRow = new ActionRowBuilder();
            embedData.buttons.forEach(btn => {
                const button = new ButtonBuilder()
                    .setLabel(btn.label)
                    .setURL(btn.url)
                    .setStyle(ButtonStyle.Link);
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
});

// Fonction pour mettre a jour la previsualisation
async function updatePreview(interaction, embedData) {
    const previewEmbed = new EmbedBuilder();
    if (embedData.embed.title) previewEmbed.setTitle(embedData.embed.title);
    if (embedData.embed.description) previewEmbed.setDescription(embedData.embed.description);
    if (embedData.embed.image) previewEmbed.setImage(embedData.embed.image);
    
    previewEmbed.setColor(VQC_COLOR);
    previewEmbed.setFooter({ text: VQC_FOOTER_TEXT, iconURL: VQC_LOGO });
    previewEmbed.setThumbnail(VQC_LOGO);
    previewEmbed.setTimestamp();
    
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
        embedData.buttons.forEach((btn) => {
            const button = new ButtonBuilder()
                .setLabel(btn.label)
                .setURL(btn.url)
                .setStyle(ButtonStyle.Link)
                .setDisabled(true); // Desactive en apercu
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

// 9. Connexion
client.login(process.env.DISCORD_TOKEN);
