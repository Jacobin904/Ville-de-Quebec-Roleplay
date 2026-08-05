require('dotenv').config();
const express = require('express');
const { 
    Client, GatewayIntentBits, EmbedBuilder, SlashCommandBuilder, 
    REST, Routes, ChannelType, PermissionFlagsBits, ModalBuilder, 
    TextInputBuilder, TextInputStyle, ActionRowBuilder 
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

// 3. Commandes Slash
const commands = [
    new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Vérifie la latence du bot.'),
    
    new SlashCommandBuilder()
        .setName('citation')
        .setDescription('Réponds à un message en le citant.')
        .addStringOption(option => 
            option.setName('texte')
                  .setDescription('Texte à ajouter avant la citation')),
    
    new SlashCommandBuilder()
        .setName('embed')
        .setDescription('Crée un embed personnalisé.')
        .addStringOption(option => 
            option.setName('titre')
                  .setDescription('Titre de l\'embed')
                  .setRequired(true)),
    
    new SlashCommandBuilder()
        .setName('edit-embed')
        .setDescription('Modifie un embed que tu as créé.')
        .addStringOption(option => 
            option.setName('message_id')
                  .setDescription('ID du message à modifier')
                  .setRequired(true)),
    
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
        .addUserOption(option => 
            option.setName('membre')
                  .setDescription('Le membre à avertir')
                  .setRequired(true))
        .addStringOption(option => 
            option.setName('raison')
                  .setDescription('Raison de l\'avertissement')
                  .setRequired(true)),
    
    new SlashCommandBuilder()
        .setName('clear')
        .setDescription('Supprime des messages.')
        .addIntegerOption(option => 
            option.setName('nombre')
                  .setDescription('Nombre de messages à supprimer (max 100)')
                  .setRequired(true)
                  .setMinValue(1)
                  .setMaxValue(100)),
    
    new SlashCommandBuilder()
        .setName('userinfo')
        .setDescription('Affiche les informations d\'un utilisateur.')
        .addUserOption(option => 
            option.setName('membre')
                  .setDescription('Le membre dont voir les infos')),
    
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
        console.error(' Erreur:', error);
    }
});

// 5. Système de logs
client.on('guildMemberAdd', async member => {
    const logsChannel = member.guild.channels.cache.find(c => c.name === 'logs' || c.name === 'journaux');
    if (!logsChannel) return;
    
    const embed = new EmbedBuilder()
        .setColor('#059669')
        .setTitle(' Nouveau membre')
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
        .setTitle('️ Message supprimé')
        .addFields(
            { name: 'Auteur', value: `${message.author.tag} (${message.author.id})`, inline: true },
            { name: 'Canal', value: `<#${message.channel.id}>`, inline: true },
            { name: 'Contenu', value: message.content.substring(0, 1000) || '*Message sans texte*' }
        )
        .setTimestamp();
    
    await logsChannel.send({ embeds: [embed] });
});

// 6. Système de citations (CORRIGÉ)
client.on('messageCreate', async message => {
    if (message.mentions.has(client.user) && message.reference && message.reference.messageId) {
        try {
            const repliedMessage = await message.channel.messages.fetch(message.reference.messageId);
            const author = repliedMessage.author;
            const customText = message.content.replace(`<@${client.user.id}>`, '').trim();
            
            const embed = new EmbedBuilder()
                .setColor('#003DA5')
                .setAuthor({
                    name: author.username,
                    iconURL: author.displayAvatarURL({ size: 128 })
                })
                .setDescription(`> ${repliedMessage.content.substring(0, 2000)}`)
                .setFooter({ text: customText ? `${customText} • Cité par ${message.author.username}` : `Cité par ${message.author.username}` })
                .setTimestamp()
                .setThumbnail(author.displayAvatarURL({ size: 256 }));
            
            await message.channel.send({ embeds: [embed] });
            
        } catch (error) {
            console.error('Erreur citation:', error);
            await message.reply('❌ Erreur lors de la création de la citation.');
        }
    }
});

// 7. Gestion des commandes
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    // === PING ===
    if (interaction.commandName === 'ping') {
        await interaction.reply(` Pong ! Latence : ${client.ws.ping}ms`);
    }

    // === CITATION ===
    if (interaction.commandName === 'citation') {
        const customText = interaction.options.getString('texte');
        
        if (!interaction.channel || !interaction.channel.isTextBased()) {
            return interaction.reply({ content: '❌ Commande invalide dans ce canal.', ephemeral: true });
        }
        
        const modal = new ModalBuilder()
            .setCustomId(`citation-${interaction.id}`)
            .setTitle('Créer une citation');
        
        const messageInput = new TextInputBuilder()
            .setCustomId('message_link')
            .setLabel('Lien du message à citer')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('https://discord.com/channels/...')
            .setRequired(true);
        
        const textInput = new TextInputBuilder()
            .setCustomId('custom_text')
            .setLabel('Texte optionnel à ajouter')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('Texte à afficher dans le footer...')
            .setRequired(false);
        
        modal.addComponents(
            new ActionRowBuilder().addComponents(messageInput),
            new ActionRowBuilder().addComponents(textInput)
        );
        
        await interaction.showModal(modal);
    }

    // === EMBED (CRÉATION) ===
    if (interaction.commandName === 'embed') {
        const title = interaction.options.getString('titre');
        
        const modal = new ModalBuilder()
            .setCustomId(`embed-create-${interaction.id}`)
            .setTitle('Créer un Embed Personnalisé');
        
        const descriptionInput = new TextInputBuilder()
            .setCustomId('description')
            .setLabel('Description')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('Contenu principal de l\'embed...')
            .setRequired(false)
            .setMaxLength(4000);
        
        const colorInput = new TextInputBuilder()
            .setCustomId('color')
            .setLabel('Couleur (hex ou nom)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('#003DA5 ou blue, red, green...')
            .setRequired(false);
        
        const authorInput = new TextInputBuilder()
            .setCustomId('author')
            .setLabel('Auteur (nom)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Nom de l\'auteur...')
            .setRequired(false);
        
        const authorIconInput = new TextInputBuilder()
            .setCustomId('author_icon')
            .setLabel('Icône auteur (URL)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('https://...')
            .setRequired(false);
        
        const footerInput = new TextInputBuilder()
            .setCustomId('footer')
            .setLabel('Footer')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Texte du footer...')
            .setRequired(false);
        
        const footerIconInput = new TextInputBuilder()
            .setCustomId('footer_icon')
            .setLabel('Icône footer (URL)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('https://...')
            .setRequired(false);
        
        const imageInput = new TextInputBuilder()
            .setCustomId('image')
            .setLabel('Image (URL)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('https://...')
            .setRequired(false);
        
        const thumbnailInput = new TextInputBuilder()
            .setCustomId('thumbnail')
            .setLabel('Miniature (URL)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('https://...')
            .setRequired(false);
        
        modal.addComponents(
            new ActionRowBuilder().addComponents(descriptionInput),
            new ActionRowBuilder().addComponents(colorInput),
            new ActionRowBuilder().addComponents(authorInput),
            new ActionRowBuilder().addComponents(authorIconInput),
            new ActionRowBuilder().addComponents(footerInput),
            new ActionRowBuilder().addComponents(footerIconInput),
            new ActionRowBuilder().addComponents(imageInput),
            new ActionRowBuilder().addComponents(thumbnailInput)
        );
        
        await interaction.showModal(modal);
        
        // Stocker le titre pour plus tard
        interaction.client.embedTitles = interaction.client.embedTitles || {};
        interaction.client.embedTitles[interaction.id] = title;
    }

    // === EDIT EMBED ===
    if (interaction.commandName === 'edit-embed') {
        const messageId = interaction.options.getString('message_id');
        
        try {
            const message = await interaction.channel.messages.fetch(messageId);
            
            // Vérifier que c'est bien l'auteur
            if (message.author.id !== interaction.user.id) {
                return interaction.reply({ 
                    content: '❌ Tu ne peux modifier que tes propres embeds.', 
                    ephemeral: true 
                });
            }
            
            const modal = new ModalBuilder()
                .setCustomId(`embed-edit-${messageId}`)
                .setTitle('Modifier l\'Embed');
            
            const descriptionInput = new TextInputBuilder()
                .setCustomId('description')
                .setLabel('Nouvelle description')
                .setStyle(TextInputStyle.Paragraph)
                .setPlaceholder('Laisser vide pour garder l\'actuelle...')
                .setRequired(false);
            
            const colorInput = new TextInputBuilder()
                .setCustomId('color')
                .setLabel('Nouvelle couleur')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('#003DA5 ou blue, red...')
                .setRequired(false);
            
            const footerInput = new TextInputBuilder()
                .setCustomId('footer')
                .setLabel('Nouveau footer')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('Laisser vide pour garder l\'actuel...')
                .setRequired(false);
            
            modal.addComponents(
                new ActionRowBuilder().addComponents(descriptionInput),
                new ActionRowBuilder().addComponents(colorInput),
                new ActionRowBuilder().addComponents(footerInput)
            );
            
            await interaction.showModal(modal);
            
        } catch (error) {
            await interaction.reply({ 
                content: '❌ Message introuvable. Vérifie l\'ID.', 
                ephemeral: true 
            });
        }
    }

    // === TICKET ===
    if (interaction.commandName === 'ticket') {
        const existingTicket = interaction.guild.channels.cache.find(
            c => c.name === `ticket-${interaction.user.username}`
        );
        
        if (existingTicket) {
            return interaction.reply({ 
                content: `❌ Tu as déjà un ticket: ${existingTicket}`, 
                ephemeral: true 
            });
        }
        
        const ticketChannel = await interaction.guild.channels.create({
            name: `ticket-${interaction.user.username}`,
            type: ChannelType.GuildText,
            topic: `Ticket de ${interaction.user.tag}`,
            permissionOverwrites: [
                {
                    id: interaction.guild.id,
                    deny: [PermissionFlagsBits.ViewChannel]
                },
                {
                    id: interaction.user.id,
                    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
                },
                {
                    id: interaction.guild.roles.cache.find(r => r.permissions.has(PermissionFlagsBits.ManageChannels))?.id || interaction.guild.ownerId,
                    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
                }
            ]
        });
        
        const embed = new EmbedBuilder()
            .setTitle('🎫 Nouveau ticket')
            .setDescription(`Bonjour ${interaction.user} !\n\nDécris ton problème ci-dessous. Un membre du staff te répondra.`)
            .setColor('#003DA5')
            .setFooter({ text: 'Utilise /close pour fermer' })
            .setTimestamp();
        
        await ticketChannel.send({ content: `${interaction.user}`, embeds: [embed] });
        await interaction.reply({ content: `✅ Ticket créé: ${ticketChannel}`, ephemeral: true });
    }

    // === CLOSE ===
    if (interaction.commandName === 'close') {
        if (!interaction.channel.name.startsWith('ticket-')) {
            return interaction.reply({ content: '❌ Commande uniquement dans un ticket.', ephemeral: true });
        }
        
        await interaction.reply({ content: '🔒 Fermeture dans 5s...', ephemeral: true });
        setTimeout(async () => {
            await interaction.channel.delete();
        }, 5000);
    }

    // === WARN ===
    if (interaction.commandName === 'warn') {
        const target = interaction.options.getUser('membre');
        const reason = interaction.options.getString('raison');
        
        const embed = new EmbedBuilder()
            .setColor('#D97706')
            .setTitle('️ Avertissement')
            .addFields(
                { name: 'Membre', value: `${target.tag} (${target.id})`, inline: true },
                { name: 'Modérateur', value: interaction.user.tag, inline: true },
                { name: 'Raison', value: reason }
            )
            .setTimestamp();
        
        const logsChannel = interaction.guild.channels.cache.find(c => c.name === 'logs');
        if (logsChannel) await logsChannel.send({ embeds: [embed] });
        
        try {
            await target.send({ embeds: [embed] });
        } catch (e) {}
        
        await interaction.reply({ content: `✅ ${target.tag} averti.`, ephemeral: true });
    }

    // === CLEAR ===
    if (interaction.commandName === 'clear') {
        const amount = interaction.options.getInteger('nombre');
        await interaction.channel.bulkDelete(amount, true);
        const msg = await interaction.reply({ content: `️ ${amount} messages supprimés.`, ephemeral: true, fetchReply: true });
        setTimeout(async () => {
            if (msg.deletable) await msg.delete();
        }, 3000);
    }

    // === USERINFO ===
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

    // === SERVERINFO ===
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

// 8. Gestion des modals (citations et embeds)
client.on('interactionCreate', async interaction => {
    if (!interaction.isModalSubmit()) return;
    
    // === MODAL CITATION ===
    if (interaction.customId.startsWith('citation-')) {
        const messageLink = interaction.fields.getTextInputValue('message_link');
        const customText = interaction.fields.getTextInputValue('custom_text');
        
        try {
            const parts = messageLink.split('/');
            const messageId = parts[parts.length - 1];
            const channelId = parts[parts.length - 2];
            
            const channel = await interaction.client.channels.fetch(channelId);
            const message = await channel.messages.fetch(messageId);
            const author = message.author;
            
            const embed = new EmbedBuilder()
                .setColor('#003DA5')
                .setAuthor({
                    name: author.username,
                    iconURL: author.displayAvatarURL({ size: 128 })
                })
                .setDescription(`> ${message.content.substring(0, 2000)}`)
                .setFooter({ text: customText ? `${customText} • Cité par ${interaction.user.username}` : `Cité par ${interaction.user.username}` })
                .setTimestamp()
                .setThumbnail(author.displayAvatarURL({ size: 256 }));
            
            await interaction.channel.send({ embeds: [embed] });
            await interaction.reply({ content: '✅ Citation créée !', ephemeral: true });
            
        } catch (error) {
            await interaction.reply({ content: '❌ Erreur. Vérifie le lien du message.', ephemeral: true });
        }
    }
    
    // === MODAL CRÉATION EMBED ===
    if (interaction.customId.startsWith('embed-create-')) {
        const title = interaction.client.embedTitles?.[interaction.customId.split('-')[2]] || 'Embed';
        const description = interaction.fields.getTextInputValue('description');
        const color = interaction.fields.getTextInputValue('color') || '#003DA5';
        const author = interaction.fields.getTextInputValue('author');
        const authorIcon = interaction.fields.getTextInputValue('author_icon');
        const footer = interaction.fields.getTextInputValue('footer');
        const footerIcon = interaction.fields.getTextInputValue('footer_icon');
        const image = interaction.fields.getTextInputValue('image');
        const thumbnail = interaction.fields.getTextInputValue('thumbnail');
        
        const embed = new EmbedBuilder()
            .setTitle(title)
            .setDescription(description || ' ')
            .setColor(color);
        
        if (author) {
            embed.setAuthor({
                name: author,
                iconURL: authorIcon || undefined
            });
        }
        
        if (footer) {
            embed.setFooter({
                text: footer,
                iconURL: footerIcon || undefined
            });
        }
        
        if (image) embed.setImage(image);
        if (thumbnail) embed.setThumbnail(thumbnail);
        
        embed.setTimestamp();
        
        const message = await interaction.channel.send({ embeds: [embed] });
        
        // Stocker les infos pour modification future
        interaction.client.userEmbeds = interaction.client.userEmbeds || {};
        interaction.client.userEmbeds[message.id] = {
            authorId: interaction.user.id,
            channelId: interaction.channel.id,
            data: {
                title,
                description,
                color,
                author,
                authorIcon,
                footer,
                footerIcon,
                image,
                thumbnail
            }
        };
        
        await interaction.reply({ 
            content: `✅ Embed créé ! Utilise \`/edit-embed message_id:${message.id}\` pour le modifier.`, 
            ephemeral: true 
        });
    }
    
    // === MODAL ÉDITION EMBED ===
    if (interaction.customId.startsWith('embed-edit-')) {
        const messageId = interaction.customId.split('-')[2];
        const newDescription = interaction.fields.getTextInputValue('description');
        const newColor = interaction.fields.getTextInputValue('color');
        const newFooter = interaction.fields.getTextInputValue('footer');
        
        try {
            const message = await interaction.channel.messages.fetch(messageId);
            
            if (message.author.id !== interaction.user.id) {
                return interaction.reply({ content: '❌ Tu ne peux modifier que tes propres embeds.', ephemeral: true });
            }
            
            const oldEmbed = message.embeds[0];
            const embed = new EmbedBuilder(oldEmbed);
            
            if (newDescription) embed.setDescription(newDescription);
            if (newColor) embed.setColor(newColor);
            if (newFooter) {
                const oldFooter = oldEmbed.footer?.text || '';
                embed.setFooter({ text: newFooter, iconURL: oldEmbed.footer?.iconURL });
            }
            
            await message.edit({ embeds: [embed] });
            await interaction.reply({ content: '✅ Embed modifié !', ephemeral: true });
            
        } catch (error) {
            await interaction.reply({ content: '❌ Erreur lors de la modification.', ephemeral: true });
        }
    }
});

// 9. Connexion
client.login(process.env.DISCORD_TOKEN);
