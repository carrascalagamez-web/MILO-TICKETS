const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'milo-tickets.json');

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readDatabase() {
    if (!fs.existsSync(DB_FILE)) {
        writeDatabase({
            guildSettings: {},
            panels: [],
            tickets: [],
            applications: [],
            staffStatistics: []
        });
    }

    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}

function writeDatabase(data) {
    fs.mkdirSync(DATA_DIR, { recursive: true });

    fs.writeFileSync(
        DB_FILE,
        JSON.stringify(data, null, 2),
        'utf8'
    );
}

function generateId() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

const database = {
    getGuildSettings(guildId) {
        const data = readDatabase();
        return data.guildSettings[guildId] || {};
    },

    setGuildSettings(guildId, settings) {
        const data = readDatabase();

        data.guildSettings[guildId] = {
            ...(data.guildSettings[guildId] || {}),
            ...settings
        };

        writeDatabase(data);
        return data.guildSettings[guildId];
    },

    getPanels(guildId) {
        return readDatabase().panels.filter(
            panel => panel.guild_id === guildId
        );
    },

    getPanel(panelId, guildId) {
        return readDatabase().panels.find(
            panel =>
                String(panel.id) === String(panelId) &&
                panel.guild_id === guildId
        ) || null;
    },

    createPanel(guildId, name, configuration = {}) {
        const data = readDatabase();

        const guildPanels = data.panels.filter(
            panel => panel.guild_id === guildId
        );

        if (guildPanels.length >= 5) {
            throw new Error(
                'Este servidor ya tiene el máximo de 5 paneles.'
            );
        }

        const panel = {
            id: generateId(),
            guild_id: guildId,
            name,
            channel_id: null,
            category_id: null,
            logs_channel_id: null,
            configuration,
            active: true,
            created_at: new Date().toISOString()
        };

        data.panels.push(panel);
        writeDatabase(data);

        return panel;
    },

    updatePanel(panelId, guildId, updates) {
        const data = readDatabase();

        const panel = data.panels.find(
            item =>
                String(item.id) === String(panelId) &&
                item.guild_id === guildId
        );

        if (!panel) return null;

        Object.assign(panel, updates);
        writeDatabase(data);

        return panel;
    },

    deletePanel(panelId, guildId) {
        const data = readDatabase();
        const length = data.panels.length;

        data.panels = data.panels.filter(
            panel =>
                !(
                    String(panel.id) === String(panelId) &&
                    panel.guild_id === guildId
                )
        );

        if (data.panels.length === length) return false;

        writeDatabase(data);
        return true;
    },

    getTicketStatistics(guildId) {
        const tickets = readDatabase().tickets.filter(
            ticket => ticket.guild_id === guildId
        );

        return {
            total: tickets.length,
            open: tickets.filter(
                ticket => ticket.status === 'open'
            ).length,
            closed: tickets.filter(
                ticket => ticket.status === 'closed'
            ).length
        };
    }
};

module.exports = database;
