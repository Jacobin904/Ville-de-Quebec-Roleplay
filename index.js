require('dotenv').config();
const express = require('express');
const { Client, GatewayIntentBits, EmbedBuilder, SlashCommandBuilder, REST, Routes, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits } = require('discord.js');
const axios = require('axios');
const { createCanvas, loadImage, registerFont } = require('canvas');

// 1. Serveur web pour garder le bot en vie sur Render
const app = express();
const port = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('🚀 Bot VQC est en ligne ! Remplace tous les bots sauf Melonly.'));
app.listen(port, () => console.log(`Serveur web actif sur le port ${port}`));

// 2. Initialisation du Client Discord
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
        .setName('joueur')
        .setDescription('Affiche les infos d\'un joueur via l\'API Melonly.')
        .addStringOption(option => 
            option.setName('roblox')
                  .setDescription('Le nom d\'utilisateur Roblox du joueur')
                  .setRequired(true)),
    
    new SlashCommandBuilder()
        .setName('citation')
        .setDescription('Crée une citation à partir d\'un message.')
        .addStringOption(option => 
            option.setName('message_id')
                  .setDescription('ID du message à citer')
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
    console.log(` Serveur: ${client.guilds.cache.first()?.name}`);
    try {
        console.log('🔄 Enregistrement des commandes slash...');
        await rest.put(
            Routes.applicationGuildCommands(client.user.id, process.env.GUILD_ID),
            { body: commands.map(cmd => cmd.toJSON()) }
        );
        console.log('✅ Commandes enregistrées avec succès !');
    } catch (error) {
        console.error('❌ Erreur commandes:', error);
    }
});

// 5. Système de logs (remplace Carl-bot)
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
            { name: 'A rejoint le', value: `<t:${Math.floor(member.joinedTimestamp / 1000)}:D>`, inline: true }
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

// 6. Système de citations (remplace Carl-bot)
client.on('messageCreate', async message => {
    // Si on mentionne le bot en répondant à un message
    if (message.mentions.has(client.user) && message.reference && message.reference.messageId) {
        try {
            const repliedMessage = await message.channel.messages.fetch(message.reference.messageId);
            const author = repliedMessage.author;
            
            // Créer le canvas pour la citation
            const canvas = createCanvas(600, 300);
            const ctx = canvas.getContext('2d');
            
            // Fond
            ctx.fillStyle = '#0a0e1a';
            ctx.fillRect(0, 0, 600, 300);
            
            // Bordure gauche bleue
            ctx.fillStyle = '#003DA5';
            ctx.fillRect(0, 0, 10, 300);
            
            // Avatar
            try {
                const avatar = await loadImage(author.displayAvatarURL({ extension: 'png', size: 256 }));
                ctx.drawImage(avatar, 30, 30, 100, 100);
            } catch (e) {
                // Si l'avatar ne charge pas, on dessine un cercle gris
                ctx.fillStyle = '#4d8dff';
                ctx.beginPath();
                ctx.arc(80, 80, 50, 0, Math.PI * 2);
                ctx.fill();
            }
            
            // Nom d'utilisateur
            ctx.fillStyle = '#4d8dff';
            ctx.font = 'bold 24px Inter';
            ctx.fillText(author.username, 150, 50);
            
            // Texte de la citation
            ctx.fillStyle = '#e2e8f0';
            ctx.font = '18px Inter';
            const text = repliedMessage.content;
            const words = text.split(' ');
            let line = '';
            let y = 120;
            
            for (let n = 0; n < words.length; n++) {
                const testLine = line + words[n] + ' ';
                const metrics = ctx.measureText(testLine);
                const testWidth = metrics.width;
                if (testWidth > 420 && n > 0) {
                    ctx.fillText(line, 150, y);
                    line = words[n] + ' ';
                    y += 30;
                } else {
                    line = testLine;
                }
            }
            ctx.fillText(line, 150, y);
            
            // Guillemets décoratifs
            ctx.fillStyle = 'rgba(77, 141, 255, 0.2)';
            ctx.font = 'bold 150px Inter';
            ctx.fillText('"', 480, 250);
            
            // Envoyer l'image
            const attachment = { attachment: canvas.toBuffer(), name: 'citation.png' };
            await message.channel.send({ files: [attachment] });
            
        } catch (error) {
            console.error('Erreur citation:', error);
            await message.reply('❌ Erreur lors de la création de la citation.');
        }
    }
});

// 7. Gestion des interactions (commandes slash)
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'ping') {
        await interaction.reply(`🏓 Pong ! Latence : ${client.ws.ping}ms`);
    }

    if (interaction.commandName === 'joueur') {
        await interaction.deferReply();
        const robloxName = interaction.options.getString('roblox');
        const melonlyToken = process.env.MELONLY_API_TOKEN;

        try {
            // ⚠️ REMPLACE CETTE URL PAR LA VRAIE URL DE L'API MELONLY
            // Exemples possibles: 
            // - https://api.melonly.xyz/v1/users/roblox/${robloxName}
            // - https://api.melonly.xyz/v1/players/${robloxName}
            const response = await axios.get(`https://api.melonly.xyz/v1/player/${robloxName}`, {
                headers: {
                    'Authorization': `Bearer ${melonlyToken}`,
                    'Content-Type': 'application/json'
                }
            });

            const data = response.data;

            const embed = new EmbedBuilder()
                .setTitle(`📊 Profil de ${robloxName}`)
                .setColor('#003DA5')
                .addFields(
                    { name: 'Temps de jeu total', value: data.playtime || 'Non disponible', inline: true },
                    { name: 'Département', value: data.department || 'Aucun', inline: true },
                    { name: 'Statut', value: data.isVerified ? '✅ Vérifié' : ' Non vérifié', inline: true },
                    { name: 'Dernière session', value: data.lastSeen ? `<t:${Math.floor(new Date(data.lastSeen).getTime() / 1000)}:R>` : 'Jamais', inline: true }
                )
                .setFooter({ text: 'Données fournies par Melonly.xyz' })
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('Erreur Melonly:', error.message);
            await interaction.editReply('❌ Impossible de récupérer les données. Vérifie que:\n1. Le nom Roblox est correct\n2. L\'URL de l\'API Melonly est correcte dans index.js');
        }
    }

    if (interaction.commandName === 'userinfo') {
        const member = interaction.options.getMember('membre') || interaction.member;
        
        const embed = new EmbedBuilder()
            .setTitle(`👤 Informations de ${member.user.username}`)
            .setColor('#003DA5')
            .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
            .addFields(
                { name: 'Tag Discord', value: member.user.tag, inline: true },
                { name: 'ID', value: member.id, inline: true },
                { name: 'Compte créé', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:D>`, inline: true },
                { name: 'A rejoint le serveur', value: `<t:${Math.floor(member.joinedTimestamp / 1000)}:D>`, inline: true },
                { name: 'Rôles', value: member.roles.cache.filter(r => r.id !== member.guild.id).map(r => r.name).join(', ') || 'Aucun', inline: false }
            )
            .setFooter({ text: `Demandé par ${interaction.user.tag}` })
            .setTimestamp();
        
        await interaction.reply({ embeds: [embed] });
    }

    if (interaction.commandName === 'serverinfo') {
        const guild = interaction.guild;
        
        const embed = new EmbedBuilder()
            .setTitle(`🏠 Informations du serveur`)
            .setColor('#003DA5')
            .setThumbnail(guild.iconURL())
            .addFields(
                { name: 'Nom', value: guild.name, inline: true },
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
        if (logsChannel) {
            await logsChannel.send({ embeds: [embed] });
        }
        
        try {
            await target.send({ embeds: [embed] });
        } catch (e) {
            // Le membre a les DMs fermés
        }
        
        await interaction.reply({ content: `✅ ${target.tag} a été averti.`, ephemeral: true });
    }

    if (interaction.commandName === 'clear') {
        const amount = interaction.options.getInteger('nombre');
        
        await interaction.channel.bulkDelete(amount, true);
        await interaction.reply({ content: `🗑️ ${amount} messages supprimés.`, ephemeral: true });
        
        setTimeout(async () => {
            await interaction.deleteReply();
        }, 3000);
    }

    if (interaction.commandName === 'ticket') {
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
            .setDescription(`Bonjour ${interaction.user} !\n\nDécris ton problème ou ta question ci-dessous. Un membre du staff te répondra dès que possible.`)
            .setColor('#003DA5')
            .setFooter({ text: 'Pour fermer ce ticket, utilise la commande /close' })
            .setTimestamp();
        
        await ticketChannel.send({ content: `${interaction.user}`, embeds: [embed] });
        await interaction.reply({ content: `✅ Ticket créé: ${ticketChannel}`, ephemeral: true });
    }

    if (interaction.commandName === 'close') {
        if (!interaction.channel.name.startsWith('ticket-')) {
            return interaction.reply({ content: '❌ Cette commande ne peut être utilisée que dans un ticket.', ephemeral: true });
        }
        
        await interaction.reply({ content: '🔒 Le ticket sera fermé dans 5 secondes...', ephemeral: true });
        
        setTimeout(async () => {
            await interaction.channel.delete();
        }, 5000);
    }
});

// 8. Connexion
client.login(process.env.DISCORD_TOKEN);
