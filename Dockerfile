# Use the latest lightweight Node.js image
FROM node:20-alpine

# Set the working directory
WORKDIR /app

# Copy only package.json to leverage Docker layer caching
COPY package.json ./

# Install dependencies (this generates package-lock.json and node_modules)
RUN npm install

# Copy the rest of the application code into the container
COPY . .

# Expose the application port
EXPOSE 4000

# Enable polling for file changes
ENV CHOKIDAR_USEPOLLING=true

# Start the Express server
CMD ["npm", "start"]
