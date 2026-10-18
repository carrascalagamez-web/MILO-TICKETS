require('dotenv').config();

const {
    Client,
    GatewayIntentBits,
    Events,
    REST,
    Routes,
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    ChannelSelectMenuBuilder,
    ChannelType,
    ButtonBuilder,
    ButtonStyle,
    PermissionFlagsBits,
    ActivityType,
    MessageFlags
} = require('discord.js');

const database = require('./database');

// ================================================
// CONFIGURACIÓN
// ================================================

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

if (!TOKEN || !CLIENT_ID) {
    console.error('❌ Faltan DISCORD_TOKEN o CLIENT_ID.');
    process.exit(1);
}

const BRAND = 'MILO TICKETS';
const COLOR = 0x8B5CF6;

// Los asistentes pendientes se mantienen en memoria.
// Si el bot se reinicia, habrá que iniciar de nuevo el asistente.
const setupSessions = new Map();

// ================================================
// CLIENTE
// ================================================

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds
    ]
});

// ================================================
// COMANDOS SLASH
// ================================================

const commands = [
    new SlashCommandBuilder()
        .setName('help')
        .setDescription('Muestra la ayuda del bot'),

    new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Comprueba la latencia del bot'),

    new SlashCommandBuilder()
        .setName('botinfo')
        .setDescription('Muestra información del bot'),

    new SlashCommandBuilder()
        .setName('paneles')
        .setDescription('Muestra los paneles de este servidor'),

    new SlashCommandBuilder()
        .setName('crear')
        .setDescription('Crear elementos del sistema')
        .addSubcommand(sub =>
            sub.setName('panel')
                .setDescription('Inicia el asistente para crear un panel')
        ),

    new SlashCommandBuilder()
        .setName('editar')
        .setDescription('Editar elementos del sistema')
        .addSubcommand(sub =>
            sub.setName('panel')
                .setDescription('Edita un panel existente')
        ),

    new SlashCommandBuilder()
        .setName('eliminar')
        .setDescription('Eliminar elementos del sistema')
        .addSubcommand(sub =>
            sub.setName('panel')
                .setDescription('Elimina un panel existente')
        ),

    new SlashCommandBuilder()
        .setName('estadisticas')
        .setDescription('Muestra las estadísticas de tickets')
].map(command => command.toJSON());

// ================================================
// FUNCIONES GENERALES
// ================================================

function makeEmbed(title, description) {
    return new EmbedBuilder()
        .setColor(COLOR)
        .setTitle(title)
        .setDescription(description)
        .setFooter({
            text: `${BRAND} • Sistema de soporte`
        })
        .setTimestamp();
}

function isAdministrator(interaction) {
    return interaction.memberPermissions?.has(
        PermissionFlagsBits.Administrator
    ) ?? false;
}

async function denyInteraction(interaction, message) {
    const payload = {
        content: `❌ ${message}`,
        flags: MessageFlags.Ephemeral
    };

    if (interaction.replied || interaction.deferred) {
        return interaction.followUp(payload).catch(() => {});
    }

    return interaction.reply(payload).catch(() => {});
}

function getSessionKey(interaction) {
    return `${interaction.guildId}:${interaction.user.id}`;
}

function getPanelConfiguration(panel) {
    if (
        panel.configuration &&
        typeof panel.configuration === 'object'
    ) {
        return panel.configuration;
    }

    return {};
}

// ================================================
// PUBLICAR UN PANEL
// ================================================

async function publishPanel(interaction, panel) {
    const config = getPanelConfiguration(panel);

    const channelId = panel.channel_id;

    if (!channelId) {
        return denyInteraction(
            interaction,
            'Este panel todavía no tiene un canal de publicación.'
        );
    }

    const channel = await interaction.guild.channels
        .fetch(channelId)
        .catch(() => null);

    if (!channel || !channel.isTextBased() || !channel.send) {
        return denyInteraction(
            interaction,
            'No encuentro el canal de publicación configurado.'
        );
    }

    const options = Array.isArray(config.options)
        ? config.options
        : [];

    if (options.length === 0) {
        return denyInteraction(
            interaction,
            'Este panel no tiene opciones configuradas.'
        );
    }

    const embed = makeEmbed(
        config.title || `🎫 ${panel.name}`,
        config.description ||
            'Selecciona una opción para solicitar soporte.'
    );

    const select = new StringSelectMenuBuilder()
        .setCustomId(`milo:open:${panel.id}`)
        .setPlaceholder('Selecciona el tipo de soporte')
        .addOptions(
            options.slice(0, 25).map((option, index) => ({
                label: String(option.name || `Opción ${index + 1}`)
                    .slice(0, 100),
                description: String(
                    option.description || 'Abrir una solicitud de soporte'
                ).slice(0, 100),
                value: String(index)
            }))
        );

    await channel.send({
        embeds: [embed],
        components: [
            new ActionRowBuilder().addComponents(select)
        ]
    });

    return true;
}

// ================================================
// CREAR TICKET
// ================================================

async function createTicket(interaction, panel, option) {
    const guild = interaction.guild;
    const config = getPanelConfiguration(panel);

    if (!guild) {
        return denyInteraction(
            interaction,
            'Este sistema solo funciona dentro de un servidor.'
        );
    }

    const categoryId = panel.category_id;

    if (!categoryId) {
        return denyInteraction(
            interaction,
            'El panel no tiene una categoría configurada.'
        );
    }

    const category = await guild.channels
        .fetch(categoryId)
        .catch(() => null);

    if (!category || category.type !== ChannelType.GuildCategory) {
        return denyInteraction(
            interaction,
            'La categoría configurada no existe.'
        );
    }

    const existing = guild.channels.cache.find(channel =>
        channel.parentId === category.id &&
        channel.topic === `milo-ticket:${interaction.user.id}:${panel.id}`
    );

    if (existing) {
        return denyInteraction(
            interaction,
            `Ya tienes un ticket abierto: ${existing}`
        );
    }

    const botMember = guild.members.me;

    if (
        !botMember ||
        !botMember.permissions.has(
            PermissionFlagsBits.ManageChannels
        )
    ) {
        return denyInteraction(
            interaction,
            'Necesito el permiso Administrar canales para crear tickets.'
        );
    }

    const safeName = interaction.user.username
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '-')
        .replace(/-+/g, '-')
        .slice(0, 40) || 'usuario';

    const ticketChannel = await guild.channels.create({
        name: `ticket-${safeName}`,
        type: ChannelType.GuildText,
        parent: category.id,
        topic: `milo-ticket:${interaction.user.id}:${panel.id}`,
        permissionOverwrites: [
            {
                id: guild.roles.everyone.id,
                deny: [PermissionFlagsBits.ViewChannel]
            },
            {
                id: interaction.user.id,
                allow: [
                    PermissionFlagsBits.ViewChannel,
                    PermissionFlagsBits.SendMessages,
                    PermissionFlagsBits.ReadMessageHistory,
                    PermissionFlagsBits.AttachFiles,
                    PermissionFlagsBits.EmbedLinks
                ]
            },
            {
                id: botMember.id,
                allow: [
                    PermissionFlagsBits.ViewChannel,
                    PermissionFlagsBits.SendMessages,
                    PermissionFlagsBits.ReadMessageHistory,
                    PermissionFlagsBits.ManageChannels,
                    PermissionFlagsBits.ManageMessages
                ]
            }
        ]
    });

    const staffRoleId = config.staffRoleId;

    if (staffRoleId) {
        const staffRole = await guild.roles
            .fetch(staffRoleId)
            .catch(() => null);

        if (staffRole) {
            await ticketChannel.permissionOverwrites
                .edit(staffRole, {
                    ViewChannel: true,
                    SendMessages: true,
                    ReadMessageHistory: true,
                    AttachFiles: true
                })
                .catch(error => {
                    console.error(
                        'No se pudieron configurar los permisos del staff:',
                        error
                    );
                });
        }
    }

    const ticketEmbed = makeEmbed(
        `🎫 ${option.name || 'Ticket de soporte'}`,
        [
            `Hola ${interaction.user}, tu ticket ha sido creado.`,
            '',
            `**Panel:** ${panel.name}`,
            `**Motivo:** ${option.name || 'Soporte general'}`,
            '',
            'Explica tu consulta y un miembro del equipo te atenderá.'
        ].join('\n')
    );

    const closeButton = new ButtonBuilder()
        .setCustomId('milo:close')
        .setLabel('Cerrar ticket')
        .setEmoji('🔒')
        .setStyle(ButtonStyle.Danger);

    await ticketChannel.send({
        content: staffRoleId ? `<@&${staffRoleId}>` : undefined,
        embeds: [ticketEmbed],
        components: [
            new ActionRowBuilder().addComponents(closeButton)
        ],
        allowedMentions: {
            roles: staffRoleId ? [staffRoleId] : [],
            users: [interaction.user.id]
        }
    });

    // Guardado básico del ticket en la base de datos JSON.
    // Los tickets se guardan para las estadísticas.
    const dataPath = require('path').join(
        __dirname,
        'data',
        'milo-tickets.json'
    );

    try {
        const fs = require('fs');

        const data = JSON.parse(
            fs.readFileSync(dataPath, 'utf8')
        );

        data.tickets.push({
            id: ticketChannel.id,
            guild_id: guild.id,
            panel_id: panel.id,
            user_id: interaction.user.id,
            channel_id: ticketChannel.id,
            status: 'open',
            created_at: new Date().toISOString()
        });

        fs.writeFileSync(
            dataPath,
            JSON.stringify(data, null, 2),
            'utf8'
        );
    } catch (error) {
        console.error('Error guardando el ticket:', error);
    }

    return interaction.editReply({
        content: `✅ Tu ticket está listo: ${ticketChannel}`
    });
}

// ================================================
// CERRAR TICKET
// ================================================

async function closeTicket(interaction) {
    const channel = interaction.channel;

    if (
        !channel ||
        !channel.topic ||
        !channel.topic.startsWith('milo-ticket:')
    ) {
        return denyInteraction(
            interaction,
            'Este canal no parece ser un ticket de MILO TICKETS.'
        );
    }

    const ownerId = channel.topic.split(':')[1];

    const isOwner = interaction.user.id === ownerId;
    const isStaff = isAdministrator(interaction);

    if (!isOwner && !isStaff) {
        return denyInteraction(
            interaction,
            'Solo el creador del ticket o un administrador puede cerrarlo.'
        );
    }

    await interaction.deferReply({
        flags: MessageFlags.Ephemeral
    });

    const owner = await interaction.guild.members
        .fetch(ownerId)
        .catch(() => null);

    if (owner) {
        await channel.permissionOverwrites
            .edit(owner, {
                SendMessages: false
            })
            .catch(() => {});
    }

    const dataPath = require('path').join(
        __dirname,
        'data',
        'milo-tickets.json'
    );

    try {
        const fs = require('fs');
        const data = JSON.parse(
            fs.readFileSync(dataPath, 'utf8')
        );

        const ticket = data.tickets.find(
            item => item.channel_id === channel.id
        );

        if (ticket) {
            ticket.status = 'closed';
            ticket.closed_at = new Date().toISOString();
        }

        fs.writeFileSync(
            dataPath,
            JSON.stringify(data, null, 2),
            'utf8'
        );
    } catch (error) {
        console.error('Error actualizando el ticket:', error);
    }

    await channel.send({
        embeds: [
            makeEmbed(
                '🔒 Ticket cerrado',
                `Cerrado por ${interaction.user}.\nUn administrador puede eliminar este canal cuando corresponda.`
            )
        ]
    }).catch(() => {});

    return interaction.editReply({
        content: '🔒 El ticket ha sido cerrado.'
    });
}

// ================================================
// EVENTO READY
// ================================================

client.once(Events.ClientReady, async readyClient => {
    console.log(`✅ Bot conectado: ${readyClient.user.tag}`);

    readyClient.user.setPresence({
        activities: [{
            name: 'tickets de Discord',
            type: ActivityType.Watching
        }],
        status: 'online'
    });

    try {
        const rest = new REST({ version: '10' })
            .setToken(TOKEN);

        await rest.put(
            Routes.applicationCommands(CLIENT_ID),
            { body: commands }
        );

        console.log('✅ Comandos slash registrados.');
        console.log(`🌐 Servidores: ${readyClient.guilds.cache.size}`);
    } catch (error) {
        console.error('❌ Error registrando comandos:', error);
    }
});

// ================================================
// INTERACCIONES
// ================================================

client.on(Events.InteractionCreate, async interaction => {
    try {
        // --------------------------------------------
        // MENÚS SELECT
        // --------------------------------------------

        if (interaction.isStringSelectMenu()) {
            if (interaction.customId.startsWith('milo:open:')) {
                const panelId = interaction.customId
                    .slice('milo:open:'.length);

                const panel = database.getPanel(
                    panelId,
                    interaction.guildId
                );

                if (!panel || !panel.active) {
                    return denyInteraction(
                        interaction,
                        'Este panel no existe o está desactivado.'
                    );
                }

                const config = getPanelConfiguration(panel);
                const options = Array.isArray(config.options)
                    ? config.options
                    : [];

                const index = Number(interaction.values[0]);
                const option = options[index];

                if (!option) {
                    return denyInteraction(
                        interaction,
                        'La opción seleccionada no es válida.'
                    );
                }

                await interaction.deferReply({
                    flags: MessageFlags.Ephemeral
                });

                return createTicket(interaction, panel, option);
            }

            if (interaction.customId === 'milo:setup:options') {
                const key = getSessionKey(interaction);
                const session = setupSessions.get(key);

                if (!session) {
                    return denyInteraction(
                        interaction,
                        'La sesión expiró. Ejecuta /crear panel nuevamente.'
                    );
                }

                session.selected = interaction.values[0];

                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('milo:setup:add')
                        .setLabel('Añadir opción')
                        .setStyle(ButtonStyle.Success),
                    new ButtonBuilder()
                        .setCustomId('milo:setup:publish')
                        .setLabel('Guardar y publicar')
                        .setStyle(ButtonStyle.Primary),
                    new ButtonBuilder()
                        .setCustomId('milo:setup:cancel')
                        .setLabel('Cancelar')
                        .setStyle(ButtonStyle.Danger)
                );

                return interaction.update({
                    content:
                        `Panel: **${session.name}**\n` +
                        `Canal: <#${session.channelId}>\n` +
                        `Categoría: <#${session.categoryId}>\n` +
                        `Opciones configuradas: **${session.options.length}**`,
                    components: [row]
                });
            }
        }

        // --------------------------------------------
        // SELECTOR DE CANALES
        // --------------------------------------------

        if (interaction.isChannelSelectMenu()) {
            const key = getSessionKey(interaction);
            const session = setupSessions.get(key);

            if (!session) {
                return denyInteraction(
                    interaction,
                    'La sesión expiró. Inicia el asistente nuevamente.'
                );
            }

            const channel = interaction.channels.first();

            if (interaction.customId === 'milo:setup:channel') {
                session.channelId = channel.id;
                session.step = 'category';

                return interaction.update({
                    content: '📁 Selecciona la categoría donde se crearán los tickets.',
                    components: [
                        new ActionRowBuilder().addComponents(
                            new ChannelSelectMenuBuilder()
                                .setCustomId('milo:setup:category')
                                .setPlaceholder('Selecciona la categoría')
                                .setChannelTypes(
                                    ChannelType.GuildCategory
                                )
                        )
                    ]
                });
            }

            if (interaction.customId === 'milo:setup:category') {
                session.categoryId = channel.id;
                session.step = 'options';

                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('milo:setup:add')
                        .setLabel('Añadir opción')
                        .setStyle(ButtonStyle.Success),
                    new ButtonBuilder()
                        .setCustomId('milo:setup:publish')
                        .setLabel('Guardar y publicar')
                        .setStyle(ButtonStyle.Primary),
                    new ButtonBuilder()
                        .setCustomId('milo:setup:cancel')
                        .setLabel('Cancelar')
                        .setStyle(ButtonStyle.Danger)
                );

                return interaction.update({
                    content:
                        `Panel: **${session.name}**\n` +
                        `Canal: <#${session.channelId}>\n` +
                        `Categoría: <#${session.categoryId}>\n` +
                        'Añade las opciones de soporte antes de publicar.',
                    components: [row]
                });
            }
        }

        // --------------------------------------------
        // BOTONES
        // --------------------------------------------

        if (interaction.isButton()) {
            if (interaction.customId === 'milo:close') {
                return closeTicket(interaction);
            }

            const key = getSessionKey(interaction);
            const session = setupSessions.get(key);

            if (interaction.customId === 'milo:setup:cancel') {
                setupSessions.delete(key);

                return interaction.update({
                    content: '❌ Creación del panel cancelada.',
                    components: []
                });
            }

            if (!session) {
                return denyInteraction(
                    interaction,
                    'No hay una sesión activa. Inicia /crear panel nuevamente.'
                );
            }

            if (interaction.customId === 'milo:setup:add') {
                if (session.options.length >= 25) {
                    return denyInteraction(
                        interaction,
                        'Este panel ya tiene 25 opciones, el máximo de un menú.'
                    );
                }

                const nextNumber = session.options.length + 1;

                session.options.push({
                    name: `Opción ${nextNumber}`,
                    description: 'Solicitar soporte'
                });

                return interaction.reply({
                    content:
                        `✅ Añadida la opción ${nextNumber}.\n` +
                        'Puedes seguir añadiendo opciones. Para personalizar nombres y descripciones, hace falta implementar el formulario de opciones.',
                    flags: MessageFlags.Ephemeral
                });
            }

            if (interaction.customId === 'milo:setup:publish') {
                if (!isAdministrator(interaction)) {
                    return denyInteraction(
                        interaction,
                        'Necesitas permisos de administrador para crear paneles.'
                    );
                }

                if (session.options.length === 0) {
                    return denyInteraction(
                        interaction,
                        'Añade al menos una opción antes de publicar.'
                    );
                }

                await interaction.deferUpdate();

                try {
                    const panel = database.createPanel(
                        interaction.guildId,
                        session.name,
                        {
                            title: `🎫 ${session.name}`,
                            description:
                                'Selecciona el tipo de soporte que necesitas.',
                            options: session.options
                        }
                    );

                    database.updatePanel(
                        panel.id,
                        interaction.guildId,
                        {
                            channel_id: session.channelId,
                            category_id: session.categoryId
                        }
                    );

                    const savedPanel = database.getPanel(
                        panel.id,
                        interaction.guildId
                    );

                    await publishPanel(interaction, savedPanel);

                    setupSessions.delete(key);

                    return interaction.editReply({
                        content: `✅ Panel **${panel.name}** guardado y publicado.`,
                        components: []
                    });
                } catch (error) {
                    console.error('Error publicando panel:', error);

                    return interaction.followUp({
                        content: `❌ No se pudo publicar el panel: ${error.message}`,
                        flags: MessageFlags.Ephemeral
                    });
                }
            }
        }

        // --------------------------------------------
        // COMANDOS SLASH
        // --------------------------------------------

        if (!interaction.isChatInputCommand()) return;

        const commandName = interaction.commandName;

        if (commandName === 'ping') {
            return interaction.reply({
                content: `🏓 Pong: ${client.ws.ping} ms`,
                flags: MessageFlags.Ephemeral
            });
        }

        if (commandName === 'help') {
            const embed = makeEmbed(
                '🎫 MILO TICKETS',
                'Sistema de soporte para servidores de Discord.'
            ).addFields(
                {
                    name: '🎛️ Paneles',
                    value:
                        '`/crear panel`\n' +
                        '`/editar panel`\n' +
                        '`/eliminar panel`\n' +
                        '`/paneles`'
                },
                {
                    name: '📊 Utilidades',
                    value:
                        '`/ping`\n' +
                        '`/botinfo`\n' +
                        '`/estadisticas`'
                },
                {
                    name: '🎟️ Tickets',
                    value:
                        'Los usuarios pueden abrir tickets desde los paneles publicados.'
                }
            );

            return interaction.reply({
                embeds: [embed],
                flags: MessageFlags.Ephemeral
            });
        }

        if (commandName === 'botinfo') {
            const embed = makeEmbed(
                '🤖 Información del bot',
                `**Nombre:** ${client.user.tag}\n` +
                `**Servidores:** ${client.guilds.cache.size}\n` +
                `**Usuarios en caché:** ${client.users.cache.size}\n` +
                `**Latencia:** ${client.ws.ping} ms`
            );

            return interaction.reply({
                embeds: [embed],
                flags: MessageFlags.Ephemeral
            });
        }

        if (!interaction.inGuild()) {
            return denyInteraction(
                interaction,
                'Este comando solo puede utilizarse dentro de un servidor.'
            );
        }

        if (commandName === 'paneles') {
            const panels = database.getPanels(interaction.guildId);

            const description = panels.length
                ? panels.map(panel =>
                    `🎫 **${panel.name}**\n` +
                    `ID: \`${panel.id}\`\n` +
                    `Estado: ${panel.active ? 'Activo' : 'Inactivo'}`
                ).join('\n\n')
                : 'No hay paneles configurados en este servidor.';

            return interaction.reply({
                embeds: [
                    makeEmbed('📋 Paneles del servidor', description)
                ],
                flags: MessageFlags.Ephemeral
            });
        }

        if (commandName === 'estadisticas') {
            const stats = database.getTicketStatistics(
                interaction.guildId
            );

            return interaction.reply({
                embeds: [
                    makeEmbed(
                        '📊 Estadísticas',
                        `**Tickets totales:** ${stats.total}\n` +
                        `**Abiertos:** ${stats.open}\n` +
                        `**Cerrados:** ${stats.closed}`
                    )
                ],
                flags: MessageFlags.Ephemeral
            });
        }

        if (
            ['crear', 'editar', 'eliminar'].includes(commandName) &&
            !isAdministrator(interaction)
        ) {
            return denyInteraction(
                interaction,
                'Necesitas permisos de administrador para gestionar paneles.'
            );
        }

        if (
            commandName === 'crear' &&
            interaction.options.getSubcommand() === 'panel'
        ) {
            const key = getSessionKey(interaction);

            if (setupSessions.has(key)) {
                return denyInteraction(
                    interaction,
                    'Ya tienes un asistente activo. Termínalo o cancélalo primero.'
                );
            }

            const session = {
                name: `Panel ${database.getPanels(interaction.guildId).length + 1}`,
                channelId: null,
                categoryId: null,
                options: [],
                selected: null,
                step: 'channel'
            };

            setupSessions.set(key, session);

            return interaction.reply({
                content:
                    '🎫 **CREACIÓN DE PANEL**\n\n' +
                    'Primero, selecciona el canal donde quieres publicar el panel.',
                components: [
                    new ActionRowBuilder().addComponents(
                        new ChannelSelectMenuBuilder()
                            .setCustomId('milo:setup:channel')
                            .setPlaceholder('Selecciona el canal')
                            .setChannelTypes(ChannelType.GuildText)
                    )
                ],
                flags: MessageFlags.Ephemeral
            });
        }

        if (
            commandName === 'editar' &&
            interaction.options.getSubcommand() === 'panel'
        ) {
            return denyInteraction(
                interaction,
                'La edición de paneles todavía no está implementada.'
            );
        }

        if (
            commandName === 'eliminar' &&
            interaction.options.getSubcommand() === 'panel'
        ) {
            return denyInteraction(
                interaction,
                'La eliminación interactiva de paneles todavía no está implementada.'
            );
        }
    } catch (error) {
        console.error('❌ Error procesando interacción:', error);

        const payload = {
            content: '❌ Ocurrió un error. Revisa los logs del bot.',
            flags: MessageFlags.Ephemeral
        };

        if (interaction.isRepliable()) {
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp(payload).catch(() => {});
            } else {
                await interaction.reply(payload).catch(() => {});
            }
        }
    }
});

// ================================================
// ERRORES
// ================================================

client.on(Events.Error, error => {
    console.error('❌ Error del cliente Discord:', error);
});

process.on('unhandledRejection', error => {
    console.error('❌ Promesa rechazada:', error);
});

process.on('uncaughtException', error => {
    console.error('❌ Excepción no controlada:', error);
});

// ================================================
// INICIO
// ================================================

client.login(TOKEN).catch(error => {
    console.error('❌ No se pudo iniciar sesión en Discord:', error);
    process.exit(1);
});
