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
app.get('/', (req, res) => res.send('🚀 Bot VQC en ligne !'));
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

// Stockage des embeds en cours de création
client.pendingEmbeds = new Map();

// 3. Commandes Slash
const commands = [
    new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Vérifie la latence du bot.'),
    
    new SlashCommandBuilder()
        .setName('embed')
        .setDescription('Crée un embed interactif avec prévisualisation.'),
    
    new SlashCommandBuilder()
        .setName('ticket')
        .setDescription('Ouvre un ticket de support.'),
    
    new SlashCommandBuilder()
        .setName('close')
        .setDescription('Ferme le ticket actuel.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
    
    new SlashCommandBuilder()
        .setName('warn')
        .setDescription('Avertir un membre.')
        .addUserOption(option => option.setName('membre').setDescription('Le membre à avertir').setRequired(true))
        .addStringOption(option => option.setName('raison').setDescription('Raison de l\'avertissement').setRequired(true)),
    
    new SlashCommandBuilder()
        .setName('clear')
        .setDescription('Supprime des messages.')
        .addIntegerOption(option => option.setName('nombre').setDescription('Nombre de messages à supprimer (max 100)').setRequired(true).setMinValue(1).setMaxValue(100)),
    
    new SlashCommandBuilder()
        .setName('userinfo')
        .setDescription('Affiche les informations d\'un utilisateur.')
        .addUserOption(option => option.setName('membre').setDescription('Le membre dont voir les infos')),
    
    new SlashCommandBuilder()
        .setName('serverinfo')
        .setDescription('Affiche les informations du serveur.')
];

// 4. Enregistrement des commandes
const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

client.once('clientReady', async () => {
    console.log(`✅ Connecté en tant que ${client.user.tag}`);
    try {
        await rest.put(
            Routes.applicationGuildCommands(client.user.id, process.env.GUILD_ID),
            { body: commands.map(cmd => cmd.toJSON()) }
        );
        console.log('✅ Commandes enregistrées !');
    } catch (error) {
        console.error('❌ Erreur:', error);
    }
});

// 5. Système de logs
client.on('guildMemberAdd', async member => {
    const logsChannel = member.guild.channels.cache.find(c => c.name === 'logs' || c.name === 'journaux');
    if (!logsChannel) return;
    
    const embed = new EmbedBuilder()
        .setColor('#059669')
        .setTitle('🎉 Nouveau membre')
        .addFields(
            { name: 'Membre', value: `${member.user.tag} (${member.id})`, inline: true },
            { name: 'Compte créé', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, inline: true }
        )
        .setThumbnail(member.user.displayAvatarURL())
        .setTimestamp();
    
    await logsChannel.send({ embeds: [embed] });
});

client.on('guildMemberRemove', async member => {
    const logsChannel = member.guild.channels.cache.find(c => c.name === 'logs' || c.name === 'journaux');
    if (!logsChannel) return;
    
    const embed = new EmbedBuilder()
        .setColor('#DC2626')
        .setTitle('📤 Membre parti')
        .addFields(
            { name: 'Membre', value: `${member.user.tag} (${member.id})`, inline: true },
            { name: 'A rejoint le', value: member.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:D>` : 'Inconnu', inline: true }
        )
        .setThumbnail(member.user.displayAvatarURL())
        .setTimestamp();
    
    await logsChannel.send({ embeds: [embed] });
});

client.on('messageDelete', async message => {
    if (!message.author || message.author.bot) return;
    const logsChannel = message.guild.channels.cache.find(c => c.name === 'logs' || c.name === 'journaux');
    if (!logsChannel) return;
    
    const embed = new EmbedBuilder()
        .setColor('#D97706')
        .setTitle('🗑️ Message supprimé')
        .addFields(
            { name: 'Auteur', value: `${message.author.tag} (${message.author.id})`, inline: true },
            { name: 'Canal', value: `<#${message.channel.id}>`, inline: true },
            { name: 'Contenu', value: message.content.substring(0, 1000) || '*Message sans texte*' }
        )
        .setTimestamp();
    
    await logsChannel.send({ embeds: [embed] });
});

// 6. Commande /embed - Création de la prévisualisation
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'ping') {
        await interaction.reply(`🏓 Pong ! Latence : ${client.ws.ping}ms`);
    }

    if (interaction.commandName === 'embed') {
        const previewEmbed = new EmbedBuilder()
            .setTitle('📝 Prévisualisation de l\'embed')
            .setDescription('Utilise les boutons ci-dessous pour personnaliser ton embed.')
            .setColor('#003DA5')
            .setFooter({ text: 'Créé par ' + interaction.user.username })
            .setTimestamp();
        
        // ✅ CORRECTION : Tous les emojis sont maintenant valides
        const row1 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('edit_title').setLabel('Titre').setStyle(ButtonStyle.Primary).setEmoji('📝'),
            new ButtonBuilder().setCustomId('edit_description').setLabel('Description').setStyle(ButtonStyle.Primary).setEmoji('📄'),
            new ButtonBuilder().setCustomId('edit_color').setLabel('Couleur').setStyle(ButtonStyle.Primary).setEmoji('🎨'),
            new ButtonBuilder().setCustomId('edit_author').setLabel('Auteur').setStyle(ButtonStyle.Primary).setEmoji('👤'),
            new ButtonBuilder().setCustomId('edit_footer').setLabel('Footer').setStyle(ButtonStyle.Primary).setEmoji('📌')
        );
        
        const row2 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('edit_image').setLabel('Image').setStyle(ButtonStyle.Primary).setEmoji('🖼️'),
            new ButtonBuilder().setCustomId('edit_thumbnail').setLabel('Miniature').setStyle(ButtonStyle.Primary).setEmoji('🔲'),
            new ButtonBuilder().setCustomId('edit_author_icon').setLabel('Icône Auteur').setStyle(ButtonStyle.Secondary).setEmoji('👤'),
            new ButtonBuilder().setCustomId('edit_footer_icon').setLabel('Icône Footer').setStyle(ButtonStyle.Secondary).setEmoji('🖼️'),
            new ButtonBuilder().setCustomId('send_embed').setLabel('Envoyer').setStyle(ButtonStyle.Success).setEmoji('✅')
        );
        
        const row3 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('cancel_embed').setLabel('Annuler').setStyle(ButtonStyle.Danger).setEmoji('❌')
        );
        
        const embedData = {
            authorId: interaction.user.id,
            channelId: interaction.channel.id,
            guildId: interaction.guild.id,
            embed: {
                title: null,
                description: null,
                color: '#003DA5',
                author: null,
                authorIcon: null,
                footer: null,
                footerIcon: null,
                image: null,
                thumbnail: null
            }
        };
        
        client.pendingEmbeds.set(interaction.user.id, embedData);
        
        const message = await interaction.reply({ 
            embeds: [previewEmbed], 
            components: [row1, row2, row3],
            fetchReply: true 
        });
        
        embedData.messageId = message.id;
    }

    if (interaction.commandName === 'ticket') {
        const existingTicket = interaction.guild.channels.cache.find(c => c.name === `ticket-${interaction.user.username}`);
        if (existingTicket) {
            return interaction.reply({ content: `❌ Tu as déjà un ticket : ${existingTicket}`, ephemeral: true });
        }
        
        const ticketChannel = await interaction.guild.channels.create({
            name: `ticket-${interaction.user.username}`,
            type: ChannelType.GuildText,
            topic: `Ticket de ${interaction.user.tag}`,
            permissionOverwrites: [
                { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
                { id: interaction.guild.roles.cache.find(r => r.permissions.has(PermissionFlagsBits.ManageChannels))?.id || interaction.guild.ownerId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }
            ]
        });
        
        const embed = new EmbedBuilder()
            .setTitle('🎫 Nouveau ticket')
            .setDescription(`Bonjour ${interaction.user} !\n\nDécris ton problème ci-dessous. Un membre du staff te répondra.`)
            .setColor('#003DA5')
            .setFooter({ text: 'Utilise /close pour fermer' })
            .setTimestamp();
        
        await ticketChannel.send({ content: `${interaction.user}`, embeds: [embed] });
        await interaction.reply({ content: `✅ Ticket créé : ${ticketChannel}`, ephemeral: true });
    }

    if (interaction.commandName === 'close') {
        if (!interaction.channel.name.startsWith('ticket-')) {
            return interaction.reply({ content: '❌ Cette commande ne fonctionne que dans un ticket.', ephemeral: true });
        }
        await interaction.reply({ content: '🔒 Fermeture du ticket dans 5 secondes...', ephemeral: true });
        setTimeout(async () => {
            await interaction.channel.delete();
        }, 5000);
    }

    if (interaction.commandName === 'warn') {
        const target = interaction.options.getUser('membre');
        const reason = interaction.options.getString('raison');
        
        const embed = new EmbedBuilder()
            .setColor('#D97706')
            .setTitle('⚠️ Avertissement')
            .addFields(
                { name: 'Membre', value: `${target.tag} (${target.id})`, inline: true },
                { name: 'Modérateur', value: interaction.user.tag, inline: true },
                { name: 'Raison', value: reason }
            )
            .setTimestamp();
        
        const logsChannel = interaction.guild.channels.cache.find(c => c.name === 'logs' || c.name === 'journaux');
        if (logsChannel) await logsChannel.send({ embeds: [embed] });
        
        try { await target.send({ embeds: [embed] }); } catch (e) {}
        
        await interaction.reply({ content: `✅ ${target.tag} a été averti.`, ephemeral: true });
    }

    if (interaction.commandName === 'clear') {
        const amount = interaction.options.getInteger('nombre');
        await interaction.channel.bulkDelete(amount, true);
        const msg = await interaction.reply({ content: `🗑️ ${amount} messages supprimés.`, ephemeral: true, fetchReply: true });
        setTimeout(async () => { if (msg.deletable) await msg.delete(); }, 3000);
    }

    if (interaction.commandName === 'userinfo') {
        const member = interaction.options.getMember('membre') || interaction.member;
        const embed = new EmbedBuilder()
            .setTitle(`👤 ${member.user.username}`)
            .setColor('#003DA5')
            .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
            .addFields(
                { name: 'Tag', value: member.user.tag, inline: true },
                { name: 'ID', value: member.id, inline: true },
                { name: 'Compte créé', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:D>`, inline: true },
                { name: 'A rejoint', value: member.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:D>` : 'Inconnu', inline: true },
                { name: 'Rôles', value: member.roles.cache.filter(r => r.id !== member.guild.id).map(r => r.name).join(', ') || 'Aucun', inline: false }
            )
            .setFooter({ text: `Demandé par ${interaction.user.tag}` })
            .setTimestamp();
        await interaction.reply({ embeds: [embed] });
    }

    if (interaction.commandName === 'serverinfo') {
        const guild = interaction.guild;
        const embed = new EmbedBuilder()
            .setTitle(`🏠 ${guild.name}`)
            .setColor('#003DA5')
            .setThumbnail(guild.iconURL())
            .addFields(
                { name: 'ID', value: guild.id, inline: true },
                { name: 'Propriétaire', value: `<@${guild.ownerId}>`, inline: true },
                { name: 'Membres', value: `${guild.memberCount}`, inline: true },
                { name: 'Salons', value: `${guild.channels.cache.size}`, inline: true },
                { name: 'Rôles', value: `${guild.roles.cache.size}`, inline: true },
                { name: 'Créé le', value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:D>`, inline: false }
            )
            .setFooter({ text: `Demandé par ${interaction.user.tag}` })
            .setTimestamp();
        await interaction.reply({ embeds: [embed] });
    }
});

// 7. Gestion des boutons d'embed
client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;
    
    const embedData = client.pendingEmbeds.get(interaction.user.id);
    if (!embedData) {
        return interaction.reply({ content: '❌ Aucune prévisualisation en cours. Utilise `/embed`.', ephemeral: true });
    }
    
    if (interaction.user.id !== embedData.authorId) {
        return interaction.reply({ content: '❌ Tu ne peux modifier que tes propres embeds.', ephemeral: true });
    }
    
    if (interaction.customId === 'edit_title') {
        const modal = new ModalBuilder().setCustomId('modal_title').setTitle('Modifier le titre');
        modal.addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('title_input').setLabel('Titre').setStyle(TextInputStyle.Short).setPlaceholder('Entre le titre...').setMaxLength(256).setRequired(true)
        ));
        await interaction.showModal(modal);
    }
    
    if (interaction.customId === 'edit_description') {
        const modal = new ModalBuilder().setCustomId('modal_description').setTitle('Modifier la description');
        modal.addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('description_input').setLabel('Description').setStyle(TextInputStyle.Paragraph).setPlaceholder('Entre la description...').setMaxLength(4000).setRequired(false)
        ));
        await interaction.showModal(modal);
    }
    
    if (interaction.customId === 'edit_color') {
        const modal = new ModalBuilder().setCustomId('modal_color').setTitle('Modifier la couleur');
        modal.addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('color_input').setLabel('Couleur').setStyle(TextInputStyle.Short).setPlaceholder('#003DA5, blue, red...').setMaxLength(50).setRequired(true)
        ));
        await interaction.showModal(modal);
    }
    
    if (interaction.customId === 'edit_author') {
        const modal = new ModalBuilder().setCustomId('modal_author').setTitle('Modifier l\'auteur');
        modal.addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('author_input').setLabel('Nom de l\'auteur').setStyle(TextInputStyle.Short).setPlaceholder('Nom...').setMaxLength(256).setRequired(true)
        ));
        await interaction.showModal(modal);
    }
    
    if (interaction.customId === 'edit_footer') {
        const modal = new ModalBuilder().setCustomId('modal_footer').setTitle('Modifier le footer');
        modal.addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('footer_input').setLabel('Texte du footer').setStyle(TextInputStyle.Short).setPlaceholder('Texte...').setMaxLength(2048).setRequired(true)
        ));
        await interaction.showModal(modal);
    }
    
    if (interaction.customId === 'edit_image') {
        const modal = new ModalBuilder().setCustomId('modal_image').setTitle('Modifier l\'image');
        modal.addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('image_input').setLabel('URL de l\'image').setStyle(TextInputStyle.Short).setPlaceholder('https://...').setMaxLength(2048).setRequired(true)
        ));
        await interaction.showModal(modal);
    }
    
    if (interaction.customId === 'edit_thumbnail') {
        const modal = new ModalBuilder().setCustomId('modal_thumbnail').setTitle('Modifier la miniature');
        modal.addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('thumbnail_input').setLabel('URL de la miniature').setStyle(TextInputStyle.Short).setPlaceholder('https://...').setMaxLength(2048).setRequired(true)
        ));
        await interaction.showModal(modal);
    }
    
    if (interaction.customId === 'edit_author_icon') {
        const modal = new ModalBuilder().setCustomId('modal_author_icon').setTitle('Icône de l\'auteur');
        modal.addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('author_icon_input').setLabel('URL de l\'icône').setStyle(TextInputStyle.Short).setPlaceholder('https://...').setMaxLength(2048).setRequired(true)
        ));
        await interaction.showModal(modal);
    }
    
    if (interaction.customId === 'edit_footer_icon') {
        const modal = new ModalBuilder().setCustomId('modal_footer_icon').setTitle('Icône du footer');
        modal.addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('footer_icon_input').setLabel('URL de l\'icône').setStyle(TextInputStyle.Short).setPlaceholder('https://...').setMaxLength(2048).setRequired(true)
        ));
        await interaction.showModal(modal);
    }
    
    if (interaction.customId === 'send_embed') {
        const modal = new ModalBuilder().setCustomId('modal_send').setTitle('Envoyer l\'embed');
        modal.addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('channel_input').setLabel('ID ou nom du salon').setStyle(TextInputStyle.Short).setPlaceholder('Ex: annonces ou 123456789').setMaxLength(100).setRequired(true)
        ));
        await interaction.showModal(modal);
    }
    
    if (interaction.customId === 'cancel_embed') {
        client.pendingEmbeds.delete(interaction.user.id);
        await interaction.reply({ content: '❌ Création annulée.', ephemeral: true });
        try {
            const message = await interaction.channel.messages.fetch(embedData.messageId);
            await message.delete();
        } catch (e) {}
    }
});

// 8. Gestion des modals
client.on('interactionCreate', async interaction => {
    if (!interaction.isModalSubmit()) return;
    
    const embedData = client.pendingEmbeds.get(interaction.user.id);
    if (!embedData) return;
    
    if (interaction.customId === 'modal_title') {
        embedData.embed.title = interaction.fields.getTextInputValue('title_input');
        await updatePreview(interaction, embedData);
    }
    if (interaction.customId === 'modal_description') {
        embedData.embed.description = interaction.fields.getTextInputValue('description_input') || null;
        await updatePreview(interaction, embedData);
    }
    if (interaction.customId === 'modal_color') {
        embedData.embed.color = interaction.fields.getTextInputValue('color_input');
        await updatePreview(interaction, embedData);
    }
    if (interaction.customId === 'modal_author') {
        embedData.embed.author = interaction.fields.getTextInputValue('author_input');
        await updatePreview(interaction, embedData);
    }
    if (interaction.customId === 'modal_footer') {
        embedData.embed.footer = interaction.fields.getTextInputValue('footer_input');
        await updatePreview(interaction, embedData);
    }
    if (interaction.customId === 'modal_image') {
        embedData.embed.image = interaction.fields.getTextInputValue('image_input');
        await updatePreview(interaction, embedData);
    }
    if (interaction.customId === 'modal_thumbnail') {
        embedData.embed.thumbnail = interaction.fields.getTextInputValue('thumbnail_input');
        await updatePreview(interaction, embedData);
    }
    if (interaction.customId === 'modal_author_icon') {
        embedData.embed.authorIcon = interaction.fields.getTextInputValue('author_icon_input');
        await updatePreview(interaction, embedData);
    }
    if (interaction.customId === 'modal_footer_icon') {
        embedData.embed.footerIcon = interaction.fields.getTextInputValue('footer_icon_input');
        await updatePreview(interaction, embedData);
    }
    
    if (interaction.customId === 'modal_send') {
        const channelInput = interaction.fields.getTextInputValue('channel_input');
        let targetChannel;
        
        if (channelInput.match(/^\d+$/)) {
            targetChannel = await interaction.client.channels.fetch(channelInput).catch(() => null);
        } else {
            targetChannel = interaction.guild.channels.cache.find(c => c.name.toLowerCase() === channelInput.toLowerCase());
        }
        
        if (!targetChannel || !targetChannel.isTextBased()) {
            return interaction.reply({ content: '❌ Salon introuvable. Vérifie l\'ID ou le nom.', ephemeral: true });
        }
        
        const finalEmbed = new EmbedBuilder();
        if (embedData.embed.title) finalEmbed.setTitle(embedData.embed.title);
        if (embedData.embed.description) finalEmbed.setDescription(embedData.embed.description);
        finalEmbed.setColor(embedData.embed.color || '#003DA5');
        
        if (embedData.embed.author) {
            finalEmbed.setAuthor({ name: embedData.embed.author, iconURL: embedData.embed.authorIcon || undefined });
        }
        if (embedData.embed.footer) {
            finalEmbed.setFooter({ text: embedData.embed.footer, iconURL: embedData.embed.footerIcon || undefined });
        }
        if (embedData.embed.image) finalEmbed.setImage(embedData.embed.image);
        if (embedData.embed.thumbnail) finalEmbed.setThumbnail(embedData.embed.thumbnail);
        finalEmbed.setTimestamp();
        
        await targetChannel.send({ embeds: [finalEmbed] });
        client.pendingEmbeds.delete(interaction.user.id);
        
        await interaction.reply({ content: `✅ Embed envoyé dans ${targetChannel} !`, ephemeral: true });
        
        try {
            const message = await interaction.channel.messages.fetch(embedData.messageId);
            await message.delete();
        } catch (e) {}
    }
});

// Fonction pour mettre à jour la prévisualisation
async function updatePreview(interaction, embedData) {
    const previewEmbed = new EmbedBuilder();
    
    if (embedData.embed.title) previewEmbed.setTitle(embedData.embed.title);
    if (embedData.embed.description) previewEmbed.setDescription(embedData.embed.description);
    previewEmbed.setColor(embedData.embed.color || '#003DA5');
    
    if (embedData.embed.author) {
        previewEmbed.setAuthor({ name: embedData.embed.author, iconURL: embedData.embed.authorIcon || undefined });
    }
    if (embedData.embed.footer) {
        previewEmbed.setFooter({ text: embedData.embed.footer, iconURL: embedData.embed.footerIcon || undefined });
    }
    if (embedData.embed.image) previewEmbed.setImage(embedData.embed.image);
    if (embedData.embed.thumbnail) previewEmbed.setThumbnail(embedData.embed.thumbnail);
    previewEmbed.setTimestamp();
    
    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('edit_title').setLabel('Titre').setStyle(ButtonStyle.Primary).setEmoji('📝'),
        new ButtonBuilder().setCustomId('edit_description').setLabel('Description').setStyle(ButtonStyle.Primary).setEmoji('📄'),
        new ButtonBuilder().setCustomId('edit_color').setLabel('Couleur').setStyle(ButtonStyle.Primary).setEmoji('🎨'),
        new ButtonBuilder().setCustomId('edit_author').setLabel('Auteur').setStyle(ButtonStyle.Primary).setEmoji('👤'),
        new ButtonBuilder().setCustomId('edit_footer').setLabel('Footer').setStyle(ButtonStyle.Primary).setEmoji('📌')
    );
    
    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('edit_image').setLabel('Image').setStyle(ButtonStyle.Primary).setEmoji('🖼️'),
        new ButtonBuilder().setCustomId('edit_thumbnail').setLabel('Miniature').setStyle(ButtonStyle.Primary).setEmoji('🔲'),
        new ButtonBuilder().setCustomId('edit_author_icon').setLabel('Icône Auteur').setStyle(ButtonStyle.Secondary).setEmoji('👤'),
        new ButtonBuilder().setCustomId('edit_footer_icon').setLabel('Icône Footer').setStyle(ButtonStyle.Secondary).setEmoji('🖼️'),
        new ButtonBuilder().setCustomId('send_embed').setLabel('Envoyer').setStyle(ButtonStyle.Success).setEmoji('✅')
    );
    
    const row3 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('cancel_embed').setLabel('Annuler').setStyle(ButtonStyle.Danger).setEmoji('❌')
    );
    
    try {
        const message = await interaction.channel.messages.fetch(embedData.messageId);
        await message.edit({ embeds: [previewEmbed], components: [row1, row2, row3] });
        await interaction.reply({ content: '✅ Prévisualisation mise à jour !', ephemeral: true });
    } catch (e) {
        await interaction.reply({ content: '❌ Erreur lors de la mise à jour.', ephemeral: true });
    }
}

// 9. Connexion
client.login(process.env.DISCORD_TOKEN);
