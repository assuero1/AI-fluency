/**
 * GET /api/voice/warmup
 *
 * Endpoint mínimo cujo único propósito é aquecer a conexão HTTP entre o
 * browser e o servidor Next.js antes do usuário clicar em Play.
 *
 * O `voice-shared.ts` chama este endpoint com `keepalive: true` no mount do
 * módulo (uma vez por sessão de página), garantindo que o TCP handshake e o
 * TLS handshake já estejam resolvidos quando a primeira requisição de áudio
 * chegar — eliminando ~100 ms de latência na conexão fria.
 */
export function GET() {
  return new Response(null, {
    status: 204,
    headers: {
      "Cache-Control": "no-store, max-age=0"
    }
  });
}
