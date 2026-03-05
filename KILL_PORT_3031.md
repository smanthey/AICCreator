# Kill Process on Port 3031

If you're getting `EADDRINUSE: address already in use :::3031`, run:

```bash
# Find and kill the process
kill $(lsof -ti :3031)

# If that doesn't work, force kill:
kill -9 $(lsof -ti :3031)

# Then verify it's free:
lsof -i :3031

# If nothing shows up, start the server:
npm run commerce:server
```

**Or use the helper script:**
```bash
npm run commerce:kill
```

**Alternative: Use a different port**
```bash
COMMERCE_PORT=3032 npm run commerce:server
```
