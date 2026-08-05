require('dotenv').config();
const express = require('express');
const { Client, GatewayIntentBits, EmbedBuilder, SlashCommandBuilder, REST, Routes } = require('discord.js');
const axios = require('axios');

// 1. Petit serveur web pour garder le bot en vie sur Render
const app = express();
const port = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Bot VQC est en ligne sur Render ! 🚀'));
app.listen(port, () => console.log(`Serveur web actif sur le port ${port}`));

// 2. Initialisation du Client Discord
const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
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
        .setName('session')
        .setDescription('Annonce le début d\'une session.')
];

// 4. Enregistrement des commandes au démarrage
const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

client.once('ready', async () => {
    console.log(`✅ Connecté en tant que ${client.user.tag}`);
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

// 5. Gestion des commandes
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'ping') {
        await interaction.reply(`🏓 Pong ! Latence : ${client.ws.ping}ms`);
    }

    if (interaction.commandName === 'session') {
        // Remplace l'ID ci-dessous par l'ID de ton rôle "Membres" ou "En session"
        await interaction.reply(`🚨 **Une session de Ville de Québec Roleplay commence maintenant !**\nCode du serveur : **VQC**\nRejoignez-nous !`);
    }

    if (interaction.commandName === 'joueur') {
        await interaction.deferReply();
        const robloxName = interaction.options.getString('roblox');
        const melonlyToken = process.env.MELONLY_API_TOKEN;

        try {
            // ⚠️ IMPORTANT : Remplace cette URL par la vraie URL de l'API Melonly 
            // (ex: https://api.melonly.xyz/v1/player/...) selon leur documentation.
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
                    { name: 'Temps de jeu', value: data.playtime || 'Non disponible', inline: true },
                    { name: 'Département', value: data.department || 'Aucun', inline: true },
                    { name: 'Statut', value: data.isVerified ? '✅ Vérifié' : '❌ Non vérifié', inline: true }
                )
                .setFooter({ text: 'Données fournies par Melonly.xyz' })
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error(error);
            await interaction.editReply('❌ Impossible de récupérer les données. Vérifie le nom ou la config API.');
        }
    }
});

// 6. Connexion
client.login(process.env.DISCORD_TOKEN);
