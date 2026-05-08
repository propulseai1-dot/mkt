FROM alpine:3.20

RUN apk add --no-cache nginx tor bash curl tini \
    && mkdir -p /run/nginx /var/log/nginx /var/log/tor /var/lib/tor \
    && rm -f /etc/nginx/http.d/default.conf

COPY torrc /etc/tor/torrc
COPY nginx.docker.conf /etc/nginx/nginx.conf
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 80

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["/entrypoint.sh"]
