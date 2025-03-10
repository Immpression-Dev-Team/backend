# Use the official Node.js image
FROM node:20-alpine3.20

# Set the working directory
WORKDIR /app

# Copy package.json and package-lock.json
COPY package.json package-lock.json ./

# Install dependencies
RUN npm install

# Copy the rest of the application code
COPY . .

# Expose the application port
EXPOSE 4000

# Enable polling for file changes
ENV CHOKIDAR_USEPOLLING=true

# Start the application
CMD ["npm", "start"]
