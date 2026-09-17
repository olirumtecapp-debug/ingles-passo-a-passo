# HANDOFF DE SEGURANÇA: REMOÇÃO DA CHAVE ASAAS NO FRONTEND

**Palavra-chave de Continuidade:** `ELEVATE_ASAAS_SECURED_2026`
**Data:** 17/09/2026
**Projeto:** ELEVATE / Inglês Passo a Passo (`D:\ProjetosGITHUB\ingles-passo-a-passo`)
**Repositório/Produção:** `https://ingles-passo-a-passo.vercel.app` (branch `main`)
**Guia Oficial de Processos:** https://auditoria-projetos.vercel.app/processos.html

---

## 1. O que foi feito nesta etapa

- **Problema resolvido:** A chave de produção da API do Asaas (string longa base64 iniciando em `$aact_prod_...`) estava exposta no código cliente dos arquivos HTML do projeto.
- **Protocolo de backup respeitado:**
  - `D:\ProjetosGITHUB\ingles-passo-a-passo\lingoclone.html.bak_2026-09-17_11-25` (2.103.012 bytes)
  - `D:\ProjetosGITHUB\ingles-passo-a-passo\index.html.bak_2026-09-17_11-25` (2.098.324 bytes)
- **Arquivos modificados:**
  - `lingoclone.html` (linha 3448): `const ASAAS_API_KEY = "";`
  - `index.html` (linha 3484): `const ASAAS_API_KEY = "";`
- **Motivo de manter a constante vazia:** A constante `ASAAS_API_KEY` ainda é referenciada em `DEFAULT_ASAAS_SETTINGS = { apiKey: ASAAS_API_KEY, ... }`. Torná-la string vazia (`""`) eliminou o vazamento da credencial sem quebrar o objeto e sem gerar `ReferenceError` em runtime.
- **Status do pagamento:** O frontend opera com PIX estático via payload/QR code e webhook no backend (`api/asaas-webhook.js`), não dependendo da chamada direta à API do Asaas pelo navegador.

---

## 2. Status Atual do Projeto

- **Frontend (ELEVATE):**
  - Chave Asaas eliminada de `lingoclone.html` e `index.html`.
  - Backups locais íntegros salvos na raiz do projeto.
- **Backend (`codelogic-pro/api/create-pix.js`):**
  - Chave de produção já foi retirada e movida para variável de ambiente na Vercel em etapa anterior.
- **Git / Deploy:**
  - As alterações foram feitas localmente nos arquivos de trabalho.
  - Caso vá commitar/deployar, siga o processo oficial:
    1. Garantir sincronização: `Copy-Item "lingoclone.html" "index.html" -Force`
    2. Commit e push para o GitHub.
    3. Rotação da chave no painel do Asaas (recomendada pois a chave antiga esteve exposta em commits anteriores).

---

## 3. Próximos Passos Recomendados para a Próxima IA

1. Lembrar o usuário de rotacionar o token no painel do Asaas e atualizar a variável de ambiente na Vercel (`ASAAS_API_KEY`).
2. Realizar commit e push das alterações via VSCode / Git (`index.html` e `lingoclone.html` sincronizados).
3. Continuar as funcionalidades pendentes planejadas para o projeto ELEVATE.

---

## 4. Auditoria de Alunos & Sincronização Cloud (Resolvido em 17/09/2026 16:30)

- **Situação reportada:** O aluno recém-cadastrado (filho) aparecia ontem no ADM e parou de aparecer hoje.
- **Diagnóstico:**
  - **Dados 100% preservados na nuvem:** Verificado diretamente no Firestore (`projects/expedicao-brasil/databases/(default)/documents/elevate_students`). O aluno **Murilo Martins** (`murilomartinsferreirammf@gmail.com`) está perfeitamente salvo com todas as métricas (105 XP, 7 aulas concluídas, status VIP ativo).
  - **Causa raiz:** O arquivo `index.html` havia sido sobrescrito por uma versão legada de `lingoclone.html` que não continha a integração de busca na nuvem (`carregarAlunosDaNuvem`), dependendo apenas do `localStorage` do navegador da sessão anterior.
- **Solução implementada:**
  - Restaurada a versão completa e moderna de 9.707 linhas a partir de `index.html.bak_2026-09-17_11-25`.
  - Chave do Asaas mantida 100% segura (`const ASAAS_API_KEY = "";`).
  - Função `refreshAdminAnalyticsData` e `carregarAlunosDaNuvem` atualizadas com `getElevateApiBase()`: busca sempre em `/api/admin/students` (ou no endpoint de produção com CORS se aberto localmente via Live Server/file), renderizando imediatamente todos os alunos reais e atualizando contadores de métricas.
  - `index.html` e `lingoclone.html` sincronizados e idênticos.

