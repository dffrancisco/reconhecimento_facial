FROM nginx:1.27-alpine
# A imagem oficial roda envsubst nos arquivos de /etc/nginx/templates na subida,
# gravando o resultado em /etc/nginx/conf.d. É assim que o segredo entra sem ficar na imagem.
COPY arquivos.conf.template /etc/nginx/templates/arquivos.conf.template
# O default.conf da imagem tem `server_name localhost` e venceria o nosso por casar exatamente
# com o Host do pedido — o nosso serviço é o único que este container atende.
RUN rm -f /etc/nginx/conf.d/default.conf
