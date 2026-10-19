# central-sync
Busca os dados do Open Finance (Pluggy) 3x por dia para a Central do Moraes. Os dados não ficam no repositório: cada execução gera um artefato temporário (3 dias) que a tarefa agendada importa no app.
Segredos necessários (Settings → Secrets and variables → Actions): PLUGGY_CLIENT_ID e PLUGGY_CLIENT_SECRET.

## Saúde (Fitbit Air pela Google Health API)
Segredos: GOOGLE_HEALTH_CLIENT_ID, GOOGLE_HEALTH_CLIENT_SECRET e GOOGLE_HEALTH_REFRESH_TOKEN. Sem eles, a parte de saúde é pulada e o Open Finance segue normal.
Os dados de saúde vão dentro do mesmo arquivo criptografado (campo `saude`): sono, HRV, FC de repouso, passos, VO2 máx., peso, gordura e treinos dos últimos 40 dias.
