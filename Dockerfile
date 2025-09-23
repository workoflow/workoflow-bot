# Use an official Node.js LTS (Long Term Support) Alpine image for a smaller footprint
# Alpine images are lightweight, which is great for containers.
# Consider using the latest LTS version, e.g., node:20-alpine or node:22-alpine, if appropriate for your project.
FROM node:18-alpine

# Set the working directory inside the container
# All subsequent commands (COPY, RUN, CMD) will be executed in this directory.
WORKDIR /usr/src/app

# Install PM2 globally within the image
# PM2 is a production process manager for Node.js applications.
# It provides features like clustering, auto-restarts, and log management.
RUN npm install pm2 -g

# Copy package.json and package-lock.json (or npm-shrinkwrap.json)
# This step is done separately to leverage Docker's layer caching.
# If these files haven't changed, Docker can reuse the cached layer from a
# previous build for the 'npm install' step, speeding up subsequent builds.
COPY package*.json ./

# Install production dependencies
# The --omit=dev flag ensures that devDependencies (like linters, test frameworks)
# specified in your package.json are not installed in the production image.
RUN npm install --omit=dev

# Copy the rest of your application source code into the image
# This includes your index.js, bot.js, and any other necessary files.
# If you have a .env file for local development, it will be copied here.
# However, for production, it's best practice to supply environment variables
# to the container at runtime (e.g., via docker-compose.yml or docker run -e).
COPY . .

# Your application listens on a port defined by process.env.port, process.env.PORT, or defaults to 3978.
# The EXPOSE instruction informs Docker that the container listens on the specified network ports at runtime.
# This is primarily for documentation and can be used by Docker linking or other networking features.
# It does not actually publish the port. Publishing is done with the -p flag in `docker run`
# or the `ports` section in `docker-compose.yml`.
EXPOSE 3978

# Command to run the application using PM2
# `pm2-runtime` is specifically designed for use in containers. It keeps PM2
# running in the foreground, which is what Docker expects for the main process of a container.
# `start index.js`: Tells PM2 to start your main application file.
# `-i 1`: Instructs PM2 to launch the application as a single process.
#         This ensures in-memory state (like feedback tracking) is consistent across all requests.
# `--name "n8n-teams-pm-bot"`: Assigns a descriptive name to your application process within PM2.
#                             This is useful for logging and management with PM2 commands.
CMD [ "pm2-runtime", "start", "index.js", "-i", "1", "--name", "n8n-teams-pm-bot" ]
