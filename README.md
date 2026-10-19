# central-sync
Busca os dados do Open Finance (Pluggy) 3x por dia para a Central do Moraes. Os dados não ficam no repositório: cada execução gera um artefato temporário (3 dias) que a tarefa agendada importa no app.
Segredos necessários (Settings → Secrets and variables → Actions): PLUGGY_CLIENT_ID e PLUGGY_CLIENT_SECRET.
