require('dotenv').config();
const express = require('express');
const { 
    Client, GatewayIntentBits, EmbedBuilder, SlashCommandBuilder, 
    REST, Routes, ChannelType, PermissionFlagsBits 
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
        .setName('embed')
        .setDescription('Crée un embed personnalisé.')
        .addStringOption(option => option.setName('titre').setDescription('Titre de l\'embed').setRequired(true))
        .addStringOption(option => option.setName('description').setDescription('Description de l\'embed').setRequired(false))
        .addStringOption(option => option.setName('couleur').setDescription('Couleur (ex: #003DA5, blue, red)').setRequired(false))
        .addStringOption(option => option.setName('auteur').setDescription('Nom de l\'auteur').setRequired(false))
        .addStringOption(option => option.setName('auteur_icone').setDescription('URL de l\'icône de l\'auteur').setRequired(false))
        .addStringOption(option => option.setName('footer').setDescription('Texte du footer').setRequired(false))
        .addStringOption(option => option.setName('footer_icone').setDescription('URL de l\'icône du footer').setRequired(false))
        .addStringOption(option => option.setName('image').setDescription('URL de l\'image principale').setRequired(false))
        .addStringOption(option => option.setName('thumbnail').setDescription('URL de la miniature').setRequired(false)),
    
    new SlashCommandBuilder()
        .setName('edit-embed')
        .setDescription('Modifie un embed que tu as créé.')
        .addStringOption(option => option.setName('message_id').setDescription('ID du message à modifier').setRequired(true))
        .addStringOption(option => option.setName('nouvelle_description').setDescription('Nouvelle description').setRequired(false))
        .addStringOption(option => option.setName('nouvelle_couleur').setDescription('Nouvelle couleur').setRequired(false))
        .addStringOption(option => option.setName('nouveau_footer').setDescription('Nouveau footer').setRequired(false)),
    
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

// 6. Gestion des commandes
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'ping') {
        await interaction.reply(`🏓 Pong ! Latence : ${client.ws.ping}ms`);
    }

    // === CRÉATION D'EMBED (SANS MODAL, 100% FIABLE) ===
    if (interaction.commandName === 'embed') {
        const title = interaction.options.getString('titre');
        const description = interaction.options.getString('description');
        const color = interaction.options.getString('couleur') || '#003DA5';
        const author = interaction.options.getString('auteur');
        const authorIcon = interaction.options.getString('auteur_icone');
        const footer = interaction.options.getString('footer');
        const footerIcon = interaction.options.getString('footer_icone');
        const image = interaction.options.getString('image');
        const thumbnail = interaction.options.getString('thumbnail');
        
        const embed = new EmbedBuilder()
            .setTitle(title)
            .setDescription(description || ' ')
            .setColor(color);
        
        if (author) embed.setAuthor({ name: author, iconURL: authorIcon || undefined });
        if (footer) embed.setFooter({ text: footer, iconURL: footerIcon || undefined });
        if (image) embed.setImage(image);
        if (thumbnail) embed.setThumbnail(thumbnail);
        
        embed.setTimestamp();
        
        const message = await interaction.channel.send({ embeds: [embed] });
        
        // Stocker en mémoire pour permettre la modification
        interaction.client.userEmbeds = interaction.client.userEmbeds || {};
        interaction.client.userEmbeds[message.id] = {
            authorId: interaction.user.id,
            channelId: interaction.channel.id
        };
        
        await interaction.reply({ 
            content: `✅ Embed créé avec succès !\n💡 Pour le modifier, utilise : \`/edit-embed message_id:${message.id}\``, 
            ephemeral: true 
        });
    }

    // === MODIFICATION D'EMBED ===
    if (interaction.commandName === 'edit-embed') {
        const messageId = interaction.options.getString('message_id');
        const newDesc = interaction.options.getString('nouvelle_description');
        const newColor = interaction.options.getString('nouvelle_couleur');
        const newFooter = interaction.options.getString('nouveau_footer');
        
        try {
            const message = await interaction.channel.messages.fetch(messageId);
            
            // Sécurité : seul le créateur peut modifier
            if (message.author.id !== interaction.user.id) {
                return interaction.reply({ content: '❌ Tu ne peux modifier que tes propres embeds.', ephemeral: true });
            }
            
            const oldEmbed = message.embeds[0];
            const embed = new EmbedBuilder(oldEmbed);
            
            if (newDesc) embed.setDescription(newDesc);
            if (newColor) embed.setColor(newColor);
            if (newFooter) {
                embed.setFooter({ text: newFooter, iconURL: oldEmbed.footer?.iconURL });
            }
            
            await message.edit({ embeds: [embed] });
            await interaction.reply({ content: '✅ Embed modifié avec succès !', ephemeral: true });
            
        } catch (error) {
            await interaction.reply({ content: '❌ Erreur : Message introuvable ou ID invalide. (Clic droit sur le message > Copier l\'ID)', ephemeral: true });
        }
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

// 7. Connexion
client.login(process.env.DISCORD_TOKEN);
