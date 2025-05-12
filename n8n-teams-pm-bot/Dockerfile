# Dockerfile.generator

# Use an official Node.js runtime as a parent image
FROM node:18-slim

# Set a working directory in the container
WORKDIR /usr/src/app

# Install Yeoman and the BotBuilder generator globally within the image
# Running as root here for global installs is fine within the Docker build context
RUN npm install -g yo generator-botbuilder --force

# Create a non-root user and switch to it
# This is good practice to avoid running your application as root
RUN useradd -ms /bin/bash appuser
USER appuser

# Set the working directory for the non-root user
WORKDIR /home/appuser/bot

# This CMD is just a placeholder for the generator image;
# we'll override it when we run the container.
CMD ["bash"]
