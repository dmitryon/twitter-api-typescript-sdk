import { Request, Response } from "express";

export class EventBus<T = any> {
  #clients = new Set<Response>();

  broadcast(data: T) {
    const payload = `data: ${JSON.stringify(data)}\n\n`;
    for (const client of this.#clients) {
      client.write(payload);
    }
  }

  get clientCount() {
    return this.#clients.size;
  }

  handler = (req: Request, res: Response) => {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive"
    });
    res.write("\n");
    this.#clients.add(res);
    req.on("close", () => { this.#clients.delete(res); });
  };
}
