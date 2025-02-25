import { Listener, ListenerContext } from "../../../Stores/Listener.js";
import { GatewayDispatchEvents, GatewayVoiceServerUpdateDispatch } from "discord-api-types/v10";
import { clientId, stateVoices } from "../../../config.js";
import { RabbitMQ, RedisKey } from "@nezuchan/constants";
import { GenKey } from "../../../Utilities/GenKey.js";
import { RoutingKey } from "@nezuchan/utilities";

export class VoiceStateUpdateListener extends Listener {
    public constructor(context: ListenerContext) {
        super(context, {
            event: GatewayDispatchEvents.VoiceServerUpdate
        });
    }

    public async run(payload: { data: GatewayVoiceServerUpdateDispatch; shardId: number }): Promise<void> {
        const old = await this.store.redis.get(GenKey(RedisKey.VOICE_SERVER_KEY, payload.data.d.guild_id));

        if (stateVoices) {
            if (payload.data.d.endpoint) {
                await this.store.redis.set(GenKey(RedisKey.VOICE_SERVER_KEY, payload.data.d.guild_id), JSON.stringify(payload.data.d));
                await this.store.redis.sadd(GenKey(`${RedisKey.VOICE_SERVER_KEY}${RedisKey.KEYS_SUFFIX}`), GenKey(RedisKey.VOICE_SERVER_KEY, payload.data.d.guild_id));
            } else {
                await this.store.redis.unlink(GenKey(RedisKey.VOICE_SERVER_KEY, payload.data.d.guild_id));
                await this.store.redis.srem(GenKey(`${RedisKey.VOICE_SERVER_KEY}${RedisKey.KEYS_SUFFIX}`), GenKey(RedisKey.VOICE_SERVER_KEY, payload.data.d.guild_id));
            }
        }

        await this.store.amqp.publish(RabbitMQ.GATEWAY_QUEUE_SEND, RoutingKey(clientId, payload.shardId), Buffer.from(JSON.stringify({
            ...payload.data,
            old: old ? JSON.parse(old) : null
        })));
    }
}
