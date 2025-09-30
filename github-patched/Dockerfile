FROM hardcoreeng/github:v0.6.501

# Copy our patched file
COPY pullrequests.ts /app/services/github/pod-github/src/sync/pullrequests.ts

# The service is already built in the base image, we just need to replace the file
# The TypeScript is transpiled at runtime or the JS is already built