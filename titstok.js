const { WebcastPushConnection } = require("tiktok-live-connector");
const WebSocket = require("ws");
const fs = require("fs");
const titsrequests = require("./titsrequests.json");

class TitsController {
    constructor(settings) {
        this.settings = settings;
        this.socket = null;
        this.items = new Map();
        this.triggers = new Map();
        this.open = false;
        this.connect.bind(this);
        this.triggerEvent.bind(this);
    }

    connect() {
        try {
            this.socket = new WebSocket('ws:127.0.0.1:42069/websocket');
            console.log('TITS websocket connected');
            this.socket.on('message', rawmsg => {
                const msg = JSON.parse(rawmsg);
                if (msg.requestID === 'availableItems') {
                    msg.data?.items?.forEach(v => {
                        this.items.set(v.name, v.ID)
                    });
                }
                if (msg.requestID === 'availableTriggers') {
                    msg.data?.triggers?.forEach(v => {
                        this.triggers.set(v.name, v.ID)
                    });
                }
            });
            this.socket.on('open', () => {
                this.open = true;
                const itemsReq = titsrequests?.availableItems;
                itemsReq.requestID = 'availableItems'
                this.socket.send(JSON.stringify(itemsReq));
                const triggersReq = titsrequests?.availableTriggers;
                triggersReq.requestID = 'availableTriggers'
                this.socket.send(JSON.stringify(triggersReq));
            });
            this.socket.on('error', () => {
                this.open = false;
                console.log('TITS websocket disconnected, reconnecting in 1 second')
                setTimeout(this.connect, 1000);
            })
        } catch (err) {
            console.log('error connecting to TITS websocket, retrying in 5 seconds.', err);
            setTimeout(this.connect, 1000);
        }
    }

    triggerEvent(eventType, eventData) {
        const eventSettings = this.settings?.events[eventType];
        if (!eventSettings?.enabled) return;
        if (eventSettings.titsCustomTriggerName?.length > 0 && this.triggers.has(eventSettings.titsCustomTriggerName)) {
            const triggerReq = titsrequests?.activateTrigger;
            triggerReq.data.triggerID = this.triggers.get(eventSettings.titsCustomTriggerName);
            this.socket.send(JSON.stringify(triggerReq));
        } else {
            const throwItemsReq = titsrequests?.throwItems;
            let points = 1;
            if (eventSettings.scalePointsByRepeatCount) points *= eventData?.repeatCount;
            if (eventSettings.scalePointsByCost) points *= eventData?.diamondCount;
            points *= eventSettings.itemsPerPoint || 1.0
            points = Math.min(Math.max(Math.round(points), 1), eventSettings.maxThrows || 1000);
            throwItemsReq.data.amountOfThrows = points;
            throwItemsReq.data.delayTime = eventSettings.delay;
            const itemList = eventSettings.itemList?.filter(v => this.items.has(v)).map(v => this.items.get(v));
            throwItemsReq.data.items = itemList.length > 0 ? itemList : [...this.items.values()];
            this.socket.send(JSON.stringify(throwItemsReq));
        }
    }
}

class TiktokController {
    constructor(settings) {
        this.settings = settings;
        this.socket = null;
        this.connect.bind(this);
    }

    connect() {
        this.socket = new WebcastPushConnection(this.settings.tiktokChannelName);
        this.socket.connect().then(state => {
            console.log(`Connected to Tiktok channel ${state.roomInfo?.owner?.display_id}, roomId ${state.roomId}`);
            this.socket.on('disconnected', () => {
                console.log('Tiktok disconnected');
            });
        }).catch(err => {
            console.error('Failed to connect to tiktok', err);
        });
    }
}
const settingsjson = fs.readFileSync("./settings.json")
const settings = JSON.parse(settingsjson);
const tits = new TitsController(settings);
const tiktok = new TiktokController(settings);

tits.connect();
tiktok.connect();

//tiktok.socket.on('chat', data => {
//    console.log(`${data.uniqueId} (userId:${data.userId}) writes: ${data.comment}`);
//});

tiktok.socket.on('gift', data => {
    console.log(`${data.uniqueId} is sending gift ${data.giftName} x${data.repeatCount}`);
    if (tits.open) tits.triggerEvent('gift', data);
});

tiktok.socket.on('emote', data => {
    console.log(`${data.uniqueId} sent emote ${data.emoteId}`);
    if (tits.open) tits.triggerEvent('emote', data);
});

tiktok.socket.on('share', (data) => {
    console.log(data.uniqueId, "shared the stream!");
    if (tits.open) tits.triggerEvent('share', data);
});
