import type { Translation } from "@clip-wallet/i18n";
import type en from "./en.js";

/** Notification text (Brazilian Portuguese). */
const messages: Translation<typeof en> = {
  "incoming.title": "Dinheiro recebido",
  "incoming.body": "Você recebeu {amount} {symbol}.",
  "incoming.many": "Você recebeu {count, plural, one {# ativo} other {# ativos}}. Abra a carteira para vê-los.",
  "nft.title": "Novo colecionável",
  "nft.body": "{name} chegou à sua carteira.",
  "nft.many": "{count, plural, one {# novo colecionável chegou} other {# novos colecionáveis chegaram}} à sua carteira.",
  "confirmed.title": "Concluído",
  "failed.title": "Transação não concluída",
  "failed.body": "Não foi possível concluir: {what}. Abra Atividade para ver os detalhes.",
  "approval.title": "{app} está aguardando você",
  "price.above": "{symbol} está acima de {price}",
  "price.below": "{symbol} está abaixo de {price}",
  "price.now": "{symbol} agora está em {price}.",
  "test.title": "As notificações estão ativadas",
  "test.body": "É assim que uma notificação da carteira aparece.",
};
export default messages;
