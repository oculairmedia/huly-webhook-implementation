FROM huly-huly-mcp:latest

USER root

COPY --chown=nodejs:nodejs server.js /app/
COPY --chown=nodejs:nodejs package.json /app/

USER nodejs

ENV NODE_ENV=production
ENV PORT=3458

EXPOSE 3458

HEALTHCHECK --interval=15s --timeout=10s --start-period=90s --retries=5 \
  CMD node -e "import('http').then(h=>h.default.get('http://localhost:3458/health',r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>{try{const s=JSON.parse(d).status;process.exit(s==='ok'||s==='degraded'?0:1)}catch{process.exit(1)}})}).on('error',()=>process.exit(1)))"

CMD ["node", "server.js"]
