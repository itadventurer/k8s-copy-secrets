FROM node:8-alpine

# Create app directory
RUN mkdir -p /usr/local/app

# Move to the app directory
WORKDIR /usr/local/app

COPY nodemon.json /usr/local/app
COPY tsconfig.json /usr/local/app/
COPY package.json /usr/local/app/
COPY yarn.lock /usr/local/app
RUN yarn

COPY src /usr/local/app/src/

CMD npm start
