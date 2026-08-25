/**
 * Contrato mínimo que la API necesita de pg-boss para re-encolar ingestas
 * (T066). El worker pasa su instancia real; los tests pueden pasar un fake.
 */
export interface PgBossSender {
  send(queue: string, data: unknown): Promise<string | null>;
}
