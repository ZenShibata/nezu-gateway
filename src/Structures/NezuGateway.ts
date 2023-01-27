/* eslint-disable @typescript-eslint/naming-convention */
/* eslint-disable class-methods-use-this */
/* eslint-disable max-len */
import EventEmitter from "node:events";
import { pino } from "pino";
import { default as IORedis } from "ioredis";
import { REST } from "@discordjs/rest";
import { resolve } from "node:path";
import { Util } from "../Utilities/Util.js";
import { ListenerStore } from "../Stores/ListenerStore.js";
import { container, Piece, Store, StoreRegistry } from "@sapphire/pieces";
import { Constants } from "../Utilities/Constants.js";
import { createAmqp, RoutingPublisher } from "@nezuchan/cordis-brokers";
import { TaskStore } from "../Stores/TaskStore.js";
import { cast } from "@sapphire/utilities";

const { default: Redis, Cluster } = IORedis;

export class NezuGateway extends EventEmitter {
    public clientId = Buffer.from(process.env.DISCORD_TOKEN!.split(".")[0], "base64").toString();

    public rest = new REST({
        api: process.env.NIRN_PROXY ?? "https://discord.com/api",
        rejectOnRateLimit: process.env.NIRN_PROXY ? () => false : null
    });

    public stores = new StoreRegistry();

    public redis =
        cast<IORedis.ClusterNode[]>(JSON.parse(process.env.REDIS_CLUSTERS ?? "[]")).length
            ? new Cluster(
                cast<IORedis.ClusterNode[]>(JSON.parse(process.env.REDIS_CLUSTERS!)),
                {
                    scaleReads: cast<IORedis.NodeRole>(process.env.REDIS_CLUSTER_SCALE_READS ?? "all"),
                    redisOptions: {
                        password: process.env.REDIS_PASSWORD,
                        username: process.env.REDIS_USERNAME,
                        db: parseInt(process.env.REDIS_DB ?? "0")
                    }
                }
            )
            : new Redis({
                username: process.env.REDIS_USERNAME!,
                password: process.env.REDIS_PASSWORD!,
                host: process.env.REDIS_HOST,
                port: Number(process.env.REDIS_PORT!),
                db: Number(process.env.REDIS_DB ?? 0)
            });

    public logger = pino({
        name: "nezu-gateway",
        timestamp: true,
        level: process.env.NODE_ENV === "production" ? "info" : "trace",
        formatters: {
            bindings: () => ({
                pid: "NezukoChan Gateway"
            })
        },
        transport: {
            targets: process.env.STORE_LOGS === "true"
                ? [
                    { target: "pino/file", level: "info", options: { destination: resolve(process.cwd(), "logs", `nezu-gateway-${this.date()}.log`) } },
                    { target: "pino-pretty", level: process.env.NODE_ENV === "production" ? "info" : "trace", options: { translateTime: "SYS:yyyy-mm-dd HH:MM:ss.l o" } }
                ]
                : [
                    { target: "pino-pretty", level: process.env.NODE_ENV === "production" ? "info" : "trace", options: { translateTime: "SYS:yyyy-mm-dd HH:MM:ss.l o" } }
                ]
        }
    });

    public amqp!: {
        sender: RoutingPublisher<string, Record<string, any>>;
    };

    public constructor() {
        super();
    }

    public date(): string {
        return Util.formatDate(Intl.DateTimeFormat("en-US", {
            year: "numeric",
            month: "numeric",
            day: "numeric",
            hour12: false
        }));
    }

    public async connect() {
        container.gateway = this;

        const { channel } = await createAmqp(process.env.AMQP_HOST ?? process.env.AMQP_URL!);

        this.amqp = {
            sender: new RoutingPublisher(channel)
        };

        if (process.env.USE_ROUTING === "true") {
            await this.amqp.sender.init({ name: Constants.QUEUE_RECV, useExchangeBinding: true, exchangeType: "direct" });
        } else {
            await this.amqp.sender.init({ name: Constants.QUEUE_RECV, useExchangeBinding: true, exchangeType: "fanout", queue: Constants.EXCHANGE });
        }

        this.stores.register(new ListenerStore());
        this.stores.register(new TaskStore());
        this.rest.setToken(process.env.DISCORD_TOKEN!);
        await Promise.all([...this.stores.values()].map((store: Store<Piece>) => store.loadAll()));
    }
}

declare module "@sapphire/pieces" {
    interface Container {
        gateway: NezuGateway;
    }
    interface StoreRegistryEntries {
        listeners: ListenerStore;
    }
}
