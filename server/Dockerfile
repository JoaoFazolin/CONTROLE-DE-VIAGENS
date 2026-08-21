# Serve o frontend estático (HTML/CSS/JS) com Nginx.
# Isso é só para uma pré-visualização rápida da interface — as Netlify
# Functions (backend/) NÃO rodam aqui. Para testar o sistema completo
# (frontend + functions + Supabase) em desenvolvimento, use `netlify dev`
# na raiz do projeto (ver README.md).
FROM nginx:alpine

COPY frontend/ /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
