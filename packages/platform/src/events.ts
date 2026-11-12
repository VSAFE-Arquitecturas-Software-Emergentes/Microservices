import amqp, { ChannelModel, ConfirmChannel, ConsumeMessage } from 'amqplib';
import type { Pool } from 'pg';
import { EventSchema, IntegrationEvent } from '@vsafe/contracts';
const exchange = 'vsafe.events.v1';
export class EventRuntime {
  private connection?: ChannelModel;
  private channel?: ConfirmChannel;
  private stopped = false;
  private busy = false;
  private timer?: NodeJS.Timeout;
  constructor(
    private readonly pool: Pool,
    private readonly service: string,
    private readonly keys: string[] = [],
    private readonly handle?: (event: IntegrationEvent) => Promise<void>,
  ) {}
  start() {
    this.timer = setInterval(() => {
      void this.tick();
    }, 750);
    this.timer.unref();
    void this.tick();
  }
  async stop() {
    this.stopped = true;
    clearInterval(this.timer);
    await this.channel?.close().catch(() => {});
    await this.connection?.close().catch(() => {});
  }
  private async connect() {
    if (this.channel) return;
    const connection = await amqp.connect(process.env.AMQP_URL || 'amqp://127.0.0.1:5676');
    connection.on('error', () => {});
    connection.on('close', () => {
      this.channel = undefined;
      this.connection = undefined;
    });
    const channel = await connection.createConfirmChannel();
    channel.on('error', () => {});
    await channel.assertExchange(exchange, 'topic', { durable: true });
    await channel.assertExchange('vsafe.retry.v1', 'direct', { durable: true });
    await channel.assertQueue(`${this.service}.errors`, { durable: true });
    if (this.keys.length) {
      const queue = `${this.service}.v1`;
      await channel.assertQueue(queue, { durable: true });
      for (const key of this.keys) {
        await channel.bindQueue(queue, exchange, key);
        await channel.assertQueue(`${queue}.retry.${key}`, {
          durable: true,
          arguments: {
            'x-message-ttl': 2000,
            'x-dead-letter-exchange': exchange,
            'x-dead-letter-routing-key': key,
          },
        });
        await channel.bindQueue(
          `${queue}.retry.${key}`,
          'vsafe.retry.v1',
          `${this.service}.${key}`,
        );
      }
      await channel.prefetch(1);
      await channel.consume(
        queue,
        (msg) => {
          if (msg) void this.receive(channel, msg);
        },
        { noAck: false },
      );
    }
    this.connection = connection;
    this.channel = channel;
  }
  private async receive(channel: ConfirmChannel, msg: ConsumeMessage) {
    try {
      const event = EventSchema.parse(JSON.parse(msg.content.toString()));
      if (!this.keys.includes(event.type)) throw new Error('UNEXPECTED_EVENT_TYPE');
      await this.handle?.(event);
      channel.ack(msg);
    } catch {
      try {
        const attempts = Number(msg.properties.headers?.attempts || 0) + 1;
        const options = { persistent: true, headers: { ...msg.properties.headers, attempts } };
        if (attempts >= 4) channel.sendToQueue(`${this.service}.errors`, msg.content, options);
        else
          channel.publish(
            'vsafe.retry.v1',
            `${this.service}.${msg.fields.routingKey}`,
            msg.content,
            options,
          );
        await channel.waitForConfirms();
        channel.ack(msg);
      } catch {
        try {
          channel.nack(msg, false, true);
        } catch {}
      }
    }
  }
  private async tick() {
    if (this.busy || this.stopped) return;
    this.busy = true;
    try {
      await this.connect();
      const c = await this.pool.connect();
      try {
        await c.query('BEGIN');
        const rows = await c.query(
          'SELECT sequence,envelope FROM outbox WHERE published_at IS NULL ORDER BY sequence FOR UPDATE SKIP LOCKED LIMIT 25',
        );
        for (const row of rows.rows) {
          const envelope = { ...row.envelope, sequence: Number(row.sequence) };
          this.channel!.publish(exchange, envelope.type, Buffer.from(JSON.stringify(envelope)), {
            persistent: true,
            messageId: envelope.eventId,
            contentType: 'application/json',
          });
          await this.channel!.waitForConfirms();
          await c.query('UPDATE outbox SET published_at=now() WHERE sequence=$1', [row.sequence]);
        }
        await c.query('COMMIT');
      } catch (e) {
        await c.query('ROLLBACK');
        throw e;
      } finally {
        c.release();
      }
    } catch {
      const connection = this.connection;
      this.channel = undefined;
      this.connection = undefined;
      await connection?.close().catch(() => {});
    } finally {
      this.busy = false;
    }
  }
}
