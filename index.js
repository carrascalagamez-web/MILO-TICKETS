require('dotenv').config();

const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  SlashCommandBuilder,
  REST,
  Routes,
  PermissionFlagsBits,
  ChannelType,
  ActivityType
} = require('discord.js');

const Groq = require('groq-sdk');
const http = require('http');
const fs = require('fs');
const path = require('path');

// ======================================================
// ♛ NOXVEN — CONFIGURACIÓN PRINCIPAL
// ======================================================

const BRAND = '♛・𝐍𝐎𝐗𝐕𝐄𝐍';
const COLOR = 0x171717;
const SILVER = 0xC0C0C0;

const CONFIG = {
  welcomeChannel: '1553484706668871700',
  goodbyeChannel: '1562546726316019812',

  ticketPanelChannel: '1553489266695344149',

  applicationPanelChannel: '1562547495769215077',

  supportChannel: '1562547619069169674',
  allyChannel: '1562548738797609010',

  staffRole: '1543634061023772763',
  allyRole: '1543634562960072796',
  applicationManagerRole: '1543632138044309614'
};

const DATA_FILE = path.join(__dirname, 'noxven-data.json');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.DirectMessages
  ],
  partials: [
    Partials.Channel,
    Partials.Message,
    Partials.GuildMember
  ]
});

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY
});

// ======================================================
// 💾 ALMACENAMIENTO
// ======================================================

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    }
  } catch (error) {
    console.error('Error leyendo los datos:', error);
  }

  return {
    warnings: {},
    allies: {},
    points: {},
    applications: {},
    tickets: {},
    counters: {},
    automod: {},
    processedAllies: [],
    initializedGuilds: []
  };
}

const db = loadData();

function saveData() {
  const temporary = `${DATA_FILE}.tmp`;

  fs.writeFileSync(
    temporary,
    JSON.stringify(db, null, 2),
    'utf8'
  );

  fs.renameSync(temporary, DATA_FILE);
}

function incrementCounter(name) {
  db.counters[name] = (db.counters[name] || 0) + 1;
  saveData();
  return db.counters[name];
}

// ======================================================
// ♛ EMBEDS
// ======================================================

function makeEmbed(title, description, color = COLOR) {
  return new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(description)
    .setFooter({
      text: 'NOXVEN — Beyond the ordinary.'
    })
    .setTimestamp();
}

async function safeReply(interaction, options) {
  if (interaction.deferred) {
    return interaction.editReply(options).catch(() => {});
  }

  if (interaction.replied) {
    return interaction.followUp(options).catch(() => {});
  }

  return interaction.reply(options).catch(() => {});
}

// ======================================================
// 📁 CANALES Y CATEGORÍAS AUTOMÁTICOS
// ======================================================

async function findOrCreateCategory(guild, name) {
  let category = guild.channels.cache.find(
    channel =>
      channel.type === ChannelType.GuildCategory &&
      channel.name === name
  );

  if (!category) {
    category = await guild.channels.create({
      name,
      type: ChannelType.GuildCategory
    });
  }

  return category;
}

async function findOrCreateTextChannel(
  guild,
  name,
  parent,
  privateChannel = false
) {
  let channel = guild.channels.cache.find(
    item =>
      item.type === ChannelType.GuildText &&
      item.name === name &&
      item.parentId === parent.id
  );

  if (!channel) {
    const permissionOverwrites = privateChannel
      ? [
          {
            id: guild.roles.everyone.id,
            deny: [PermissionFlagsBits.ViewChannel]
          },
          {
            id: client.user.id,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ReadMessageHistory,
              PermissionFlagsBits.ManageChannels
            ]
          }
        ]
      : [];

    channel = await guild.channels.create({
      name,
      type: ChannelType.GuildText,
      parent: parent.id,
      permissionOverwrites
    });
  }

  return channel;
}

async function initializeGuild(guild) {
  await guild.channels.fetch();

  const ticketCategory = await findOrCreateCategory(
    guild,
    '♛・𝐓𝐈𝐂𝐊𝐄𝐓𝐒'
  );

  const logsCategory = await findOrCreateCategory(
    guild,
    '♛・𝐍𝐎𝐗𝐕𝐄𝐍・𝐋𝐎𝐆𝐒'
  );

  const applicationCategory = await findOrCreateCategory(
    guild,
    '♛・𝐏𝐎𝐒𝐓𝐔𝐋𝐀𝐂𝐈𝐎𝐍𝐄𝐒'
  );

  const ticketLogs = await findOrCreateTextChannel(
    guild,
    '🎫・ticket-logs',
    logsCategory,
    true
  );

  const securityLogs = await findOrCreateTextChannel(
    guild,
    '🛡️・seguridad',
    logsCategory,
    true
  );

  const memberLogs = await findOrCreateTextChannel(
    guild,
    '👥・miembros',
    logsCategory,
    true
  );

  const messageLogs = await findOrCreateTextChannel(
    guild,
    '💬・mensajes',
    logsCategory,
    true
  );

  const moderationLogs = await findOrCreateTextChannel(
    guild,
    '⚖️・moderacion',
    logsCategory,
    true
  );

  const applicationLogs = await findOrCreateTextChannel(
    guild,
    '📋・postulaciones',
    logsCategory,
    true
  );

  const errorLogs = await findOrCreateTextChannel(
    guild,
    '🚨・errores',
    logsCategory,
    true
  );

  const staffApplications = await findOrCreateTextChannel(
    guild,
    '🛡️・postulaciones-staff',
    applicationCategory,
    true
  );

  const devApplications = await findOrCreateTextChannel(
    guild,
    '💻・postulaciones-dev',
    applicationCategory,
    true
  );

  const allyApplications = await findOrCreateTextChannel(
    guild,
    '🤝・caza-allys',
    applicationCategory,
    true
  );

  const infoCategory = guild.channels.cache.find(
    channel =>
      channel.type === ChannelType.GuildCategory &&
      /bots/i.test(channel.name)
  );

  if (infoCategory) {
    const aiHelp = await findOrCreateTextChannel(
      guild,
      '🤖・ayuda-ia',
      infoCategory
    );

    if (aiHelp && !aiHelp.topic) {
      await aiHelp.setTopic(
        'Información para utilizar el soporte de IA de NOXVEN.'
      );

      await aiHelp.send({
        embeds: [
          makeEmbed(
            '🤖・𝐀𝐘𝐔𝐃𝐀 𝐈𝐀',
            [
              '¿Necesitas ayuda con NOXVEN?',
              '',
              `Utiliza el canal <#${CONFIG.supportChannel}> para consultar dudas relacionadas con nuestros servicios.`,
              '',
              'La IA puede ayudarte a comprender funciones y resolver problemas.',
              '',
              'Si necesitas intervención humana, solicita ayuda al equipo.'
            ].join('\n')
          )
        ]
      });
    }
  }

  db.channels = {
    ticketCategory: ticketCategory.id,
    ticketLogs: ticketLogs.id,
    logsCategory: logsCategory.id,
    securityLogs: securityLogs.id,
    memberLogs: memberLogs.id,
    messageLogs: messageLogs.id,
    moderationLogs: moderationLogs.id,
    applicationLogs: applicationLogs.id,
    errorLogs: errorLogs.id,
    staffApplications: staffApplications.id,
    devApplications: devApplications.id,
    allyApplications: allyApplications.id
  };

  if (!db.initializedGuilds.includes(guild.id)) {
    db.initializedGuilds.push(guild.id);
    saveData();
  }

  await ensureTicketPanel(guild);
  await ensureApplicationPanel(guild);
}

// ======================================================
// 📜 REGISTROS
// ======================================================

async function sendLog(guild, channelId, title, description) {
  if (!guild || !channelId) return;

  const channel = await guild.channels.fetch(channelId).catch(() => null);

  if (!channel || !channel.isTextBased()) return;

  await channel.send({
    embeds: [makeEmbed(title, description)]
  }).catch(() => {});
}

async function logEvent(guild, title, description, key) {
  const channelId = db.channels?.[key];

  if (channelId) {
    await sendLog(guild, channelId, title, description);
  }
}

// ======================================================
// 👋 BIENVENIDAS Y DESPEDIDAS
// ======================================================

client.on('guildMemberAdd', async member => {
  try {
    const channel = await member.guild.channels
      .fetch(CONFIG.welcomeChannel)
      .catch(() => null);

    if (!channel || !channel.isTextBased()) return;

    const embed = makeEmbed(
      '♛・𝐁𝐈𝐄𝐍𝐕𝐄𝐍𝐈𝐃𝐎 𝐀 𝐍𝐎𝐗𝐕𝐄𝐍 🖤',
      [
        '୨୧・¡Bienvenido/a a **NOXVEN**! ♛',
        `🌑 Eres nuestro miembro número **${member.guild.memberCount}**.`,
        '',
        '📜 Lee las reglas, elige tus roles y comienza tu experiencia.',
        '',
        '𓆩♛𓆪・**NOXVEN — Beyond the ordinary.**'
      ].join('\n')
    ).setThumbnail(member.user.displayAvatarURL());

    await channel.send({
      content: `<@${member.id}>`,
      embeds: [embed],
      allowedMentions: {
        users: [member.id]
      }
    });

    await logEvent(
      member.guild,
      '👤・MIEMBRO NUEVO',
      `Usuario: ${member.user.tag}\nID: ${member.id}`,
      'memberLogs'
    );
  } catch (error) {
    console.error('Error en bienvenida:', error);
  }
});

client.on('guildMemberRemove', async member => {
  try {
    const channel = await member.guild.channels
      .fetch(CONFIG.goodbyeChannel)
      .catch(() => null);

    if (!channel || !channel.isTextBased()) return;

    const embed = makeEmbed(
      '♛・𝐇𝐀𝐒𝐓𝐀 𝐏𝐑𝐎𝐍𝐓𝐎 🖤',
      [
        '୨୧・Un miembro ha dejado NOXVEN.',
        '',
        `🌑 **${member.user.tag}**, esperamos que hayas disfrutado tu tiempo en nuestra comunidad.`,
        '',
        '🖤 Las puertas de NOXVEN estarán abiertas si algún día decides regresar.',
        '',
        '𓆩♛𓆪・**NOXVEN — Beyond the ordinary.**'
      ].join('\n')
    ).setThumbnail(member.user.displayAvatarURL());

    await channel.send({
      embeds: [embed]
    });

    await logEvent(
      member.guild,
      '🚪・MIEMBRO SALIÓ',
      `Usuario: ${member.user.tag}\nID: ${member.id}`,
      'memberLogs'
    );
  } catch (error) {
    console.error('Error en despedida:', error);
  }
});

// ======================================================
// 🎫 SISTEMA DE TICKETS
// ======================================================

const TICKET_TYPES = [
  {
    label: 'General',
    emoji: '💬',
    questions: [
      '¿En qué podemos ayudarte?',
      '¿Qué ocurrió?',
      '¿Hay algún detalle adicional?'
    ]
  },
  {
    label: 'Reportar',
    emoji: '🚨',
    questions: [
      '¿A quién deseas reportar?',
      '¿Qué ocurrió?',
      '¿Tienes pruebas o evidencias?'
    ]
  },
  {
    label: 'Alianza',
    emoji: '🤝',
    questions: [
      '¿Cómo se llama tu servidor?',
      '¿Cuántos miembros tiene?',
      '¿Cuál es la invitación de tu servidor?'
    ]
  },
  {
    label: 'Claim',
    emoji: '🎁',
    questions: [
      '¿Qué deseas reclamar?',
      '¿Por qué te corresponde?',
      '¿Tienes pruebas?'
    ]
  },
  {
    label: 'Donar',
    emoji: '💎',
    questions: [
      '¿Qué deseas consultar sobre las donaciones?',
      '¿Qué necesitas saber?'
    ]
  },
  {
    label: 'Consultas comerciales',
    emoji: '💼',
    questions: [
      '¿Qué servicio te interesa?',
      '¿Cuál es tu presupuesto aproximado?',
      '¿Qué necesitas exactamente?'
    ]
  },
  {
    label: 'Bug',
    emoji: '🐛',
    questions: [
      '¿En qué sistema encontraste el error?',
      '¿Qué estabas haciendo?',
      '¿Qué resultado esperabas?'
    ]
  },
  {
    label: 'Bots',
    emoji: '🤖',
    questions: [
      '¿Qué necesitas?',
      '¿Ayuda con un bot o promocionar tu bot?',
      '¿Qué detalles debemos conocer?'
    ]
  },
  {
    label: 'Staff',
    emoji: '🛡️',
    questions: [
      '¿Cuál es el motivo de tu solicitud?',
      '¿Qué ocurrió?',
      '¿Hay información adicional?'
    ]
  },
  {
    label: 'Owners',
    emoji: '👑',
    questions: [
      '¿Cuál es el motivo de tu consulta?',
      '¿Qué necesitas comunicar?',
      '¿Hay detalles importantes?'
    ]
  }
];

function ticketPanelComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('nox_ticket_select')
        .setPlaceholder('Selecciona una categoría...')
        .addOptions(
          TICKET_TYPES.map((type, index) => ({
            label: type.label,
            emoji: type.emoji,
            value: String(index),
            description: `Abrir una solicitud de ${type.label}`
          }))
        )
    )
  ];
}

async function ensureTicketPanel(guild) {
  const channel = await guild.channels
    .fetch(CONFIG.ticketPanelChannel)
    .catch(() => null);

  if (!channel || !channel.isTextBased()) return;

  const recent = await channel.messages.fetch({
    limit: 30
  }).catch(() => null);

  if (recent?.some(message =>
    message.author.id === client.user.id &&
    message.embeds.some(embed =>
      embed.title === '♛・𝐍𝐎𝐗𝐕𝐄𝐍 | 𝐂𝐄𝐍𝐓𝐑𝐎 𝐃𝐄 𝐒𝐎𝐏𝐎𝐑𝐓𝐄'
    )
  )) return;

  await channel.send({
    embeds: [
      makeEmbed(
        '♛・𝐍𝐎𝐗𝐕𝐄𝐍 | 𝐂𝐄𝐍𝐓𝐑𝐎 𝐃𝐄 𝐒𝐎𝐏𝐎𝐑𝐓𝐄',
        [
          'Selecciona la categoría que corresponda a tu solicitud.',
          '',
          '💬 General',
          '🚨 Reportar',
          '🤝 Alianza',
          '🎁 Claim',
          '💎 Donar',
          '💼 Consultas comerciales',
          '🐛 Bug',
          '🤖 Bots',
          '🛡️ Staff',
          '👑 Owners',
          '',
          '♛・𝐍𝐎𝐗𝐕𝐄𝐍 — 𝐓𝐔 𝐒𝐎𝐋𝐈𝐂𝐈𝐓𝐔𝐃, 𝐍𝐔𝐄𝐒𝐓𝐑𝐀 𝐏𝐑𝐈𝐎𝐑𝐈𝐃𝐀𝐃.'
        ].join('\n')
      )
    ],
    components: ticketPanelComponents()
  });
}

function ticketActions() {
  return [
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('nox_ticket_action')
        .setPlaceholder('Administrar ticket...')
        .addOptions([
          { label: 'Cerrar', emoji: '🔒', value: 'close' },
          { label: 'Reclamar', emoji: '🙋', value: 'claim' },
          { label: 'Liberar', emoji: '🔓', value: 'release' },
          { label: 'Añadir usuario', emoji: '➕', value: 'add' },
          { label: 'Quitar usuario', emoji: '➖', value: 'remove' },
          { label: 'Ver participantes', emoji: '👥', value: 'participants' },
          { label: 'Avisar usuario', emoji: '🔔', value: 'notify' },
          { label: 'Reabrir', emoji: '🔄', value: 'reopen' },
          { label: 'Eliminar', emoji: '🗑️', value: 'delete' }
        ])
    )
  ];
}

function isStaff(member) {
  if (!member) return false;

  return member.permissions.has(PermissionFlagsBits.Administrator) ||
    member.roles.cache.has(CONFIG.staffRole);
}

async function openTicket(interaction, typeIndex) {
  const type = TICKET_TYPES[typeIndex];

  if (!type) return;

  const guild = interaction.guild;

  const existing = Object.values(db.tickets).find(
    ticket =>
      ticket.guildId === guild.id &&
      ticket.userId === interaction.user.id &&
      ticket.status === 'open'
  );

  if (existing) {
    return interaction.reply({
      content: `Ya tienes un ticket abierto: <#${existing.channelId}>`,
      ephemeral: true
    });
  }

  const category = await guild.channels
    .fetch(db.channels?.ticketCategory)
    .catch(() => null);

  if (!category) {
    return interaction.reply({
      content: 'No se encontró la categoría de tickets.',
      ephemeral: true
    });
  }

  const channel = await guild.channels.create({
    name: `ticket-${interaction.user.username}`
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .slice(0, 80),
    type: ChannelType.GuildText,
    parent: category.id,
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
        id: client.user.id,
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

  const answers = [];
  const prompts = type.questions.slice(0, 5);

  const modal = new ModalBuilder()
    .setCustomId(`nox_ticket_form_${typeIndex}`)
    .setTitle(`NOXVEN | ${type.label}`);

  for (let i = 0; i < prompts.length; i++) {
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId(`answer_${i}`)
          .setLabel(prompts[i].slice(0, 45))
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(500)
      )
    );
  }

  // Discord no permite abrir un modal y crear un canal de forma
  // fiable después de dejar la interacción sin responder.
  // El formulario se procesa antes de crear el ticket.
  await channel.delete().catch(() => {});

  return interaction.showModal(modal);
}

async function createTicketFromModal(interaction, typeIndex) {
  const type = TICKET_TYPES[typeIndex];
  const guild = interaction.guild;

  const existing = Object.values(db.tickets).find(
    ticket =>
      ticket.guildId === guild.id &&
      ticket.userId === interaction.user.id &&
      ticket.status === 'open'
  );

  if (existing) {
    return interaction.reply({
      content: `Ya tienes un ticket abierto: <#${existing.channelId}>`,
      ephemeral: true
    });
  }

  await interaction.deferReply({ ephemeral: true });

  const category = await guild.channels
    .fetch(db.channels?.ticketCategory)
    .catch(() => null);

  if (!category) {
    return interaction.editReply('No se encontró la categoría de tickets.');
  }

  const channel = await guild.channels.create({
    name: `ticket-${interaction.user.username}`
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .slice(0, 80),
    type: ChannelType.GuildText,
    parent: category.id,
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
          PermissionFlagsBits.AttachFiles
        ]
      },
      {
        id: client.user.id,
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

  const answers = type.questions.slice(0, 5).map((question, i) => ({
    question,
    answer: interaction.fields.getTextInputValue(`answer_${i}`)
  }));

  db.tickets[channel.id] = {
    guildId: guild.id,
    channelId: channel.id,
    userId: interaction.user.id,
    type: type.label,
    status: 'open',
    claimedBy: null,
    createdAt: Date.now(),
    answers
  };

  saveData();

  await channel.send({
    content: `<@${interaction.user.id}> <@&${CONFIG.staffRole}>`,
    allowedMentions: {
      users: [interaction.user.id],
      roles: [CONFIG.staffRole]
    }
  });

  await channel.send
