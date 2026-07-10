# PR 7 — QA e preparação de release

Data da validação: 10 de julho de 2026

## Escopo concluído

- Corrigido o overflow horizontal em Chat, Perfil e Conexões nas larguras móveis mais estreitas.
- Adicionado foco, retenção de foco, Escape e restauração do foco para os diálogos de trocar tema e limpar histórico.
- Tornados os estados de conexão mais honestos: `Configurado` indica presença de configuração, não sucesso operacional.
- Incluídos cenários E2E para diálogo acessível, indisponibilidade e repetição de teste de conexão, fala, áudio, telas somente leitura e dados de resumo.
- Incluída matriz visual de 12 superfícies em 320×568, 360×800, 375×812, 390×844 e 430×932.
- Endurecido o runtime QA: portas ocupadas interrompem a execução, o servidor temporário permanece vinculado ao runner e a base QA limpa não herda o usuário pessoal de `.env.local`.

## Evidência do gate de release

Comando executado:

```sh
npm run test:release
```

Resultado final: aprovado.

| Verificação | Resultado |
| --- | --- |
| Lint | aprovado |
| TypeScript | aprovado |
| Testes unitários | 15 arquivos, 46 testes aprovados |
| Build de produção | aprovado |
| Segredos no bundle cliente | nenhum segredo configurado encontrado |
| Integração QA | 25 verificações aprovadas; duas fixtures recuperadas |
| E2E | 11 cenários aprovados |
| Matriz visual | 60 combinações de tela e viewport aprovadas, sem overflow ou navegação cortada |
| Smoke em base QA vazia | onboarding, offline, service worker, conexões e áudio inexistente aprovados |
| Limpeza QA | nenhuma fixture persistida |

## Limite desta aprovação

Este gate aprova o artefato local e a base QA. A aceitação em ambiente publicado — host/origem de produção e uso em dispositivo físico — continua sendo a etapa de produção do PR 8.
