# Remote Access

How to access the Atlas dashboard from outside the local machine.

## Option 1: Tailscale (Recommended)

Tailscale creates a private mesh VPN. No port forwarding, no public exposure.

### Setup
```sh
# Install
brew install tailscale

# Start and authenticate
sudo tailscaled &
tailscale up
```

### Access
Once both devices are on the same Tailnet:
```
http://<mac-tailscale-ip>:3141
```

Find your Tailscale IP: `tailscale ip -4`

### Lock it down
The dashboard binds to `0.0.0.0:3141` by default. To restrict to Tailscale only, change `server.js` listen address:
```js
app.listen(PORT, '100.x.y.z'); // your Tailscale IP
```

Or keep it on all interfaces and rely on macOS firewall + Tailscale ACLs.

## Option 2: Cloudflare Tunnel

Zero-trust tunnel without opening ports. Requires a Cloudflare account.

```sh
brew install cloudflared
cloudflared tunnel login
cloudflared tunnel create atlas
cloudflared tunnel route dns atlas atlas.yourdomain.com
cloudflared tunnel --url http://localhost:3141 run atlas
```

Add auth via Cloudflare Access to require login.

## Option 3: SSH Tunnel (Quick and Dirty)

From the remote machine:
```sh
ssh -L 3141:localhost:3141 derek@<mac-ip>
```
Then open `http://localhost:3141` on the remote machine.

## Security Notes

- The dashboard has no authentication. Anyone who can reach port 3141 can read/write briefing data.
- For any internet-facing option, add basic auth or a reverse proxy with auth.
- Tailscale is the simplest secure option since only your devices can see each other.
- Never expose port 3141 directly to the internet without authentication.
