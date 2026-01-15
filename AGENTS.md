The intention of this repository is to maintain a static website that showcases photographs of birds that the author has taken.  The website should model an encyclopedia, but not follow wikipedia too closely. There is a home page describing the overall website, that has an index listing of all of the birds that have images.

The intended use case of this repo is for a bird photographer to clone this repo, add their own images to public/img, and then be able to deploy public/ to a static website to be served.
 
### The index page:
Alphabetically sorted links to all of the birds in the project.  Also gives some information about the collection, and the author.

### The bird pages:
The bird pages should detail information about the species.  This information should be pulled from ebird.  Also, metadata from the image should be used such as latitude / longitude, capture date, and camera equipment. Include as much information about the image as possible, since the intention is to showcase the photography as much as the bird.  All images can be displayed on the page.  The image should be prominently placed such that it grabs users attention.

Tech stack:
Generally, the pages should be static. Javascript can be used.  A basic node.js webserver should be created to serve the public/ directory on a local port.

The config file:
Contains configuration used throughout the project
* Author information

The .env file: contains auth information for various integrations

Project layout:
The project contains a directory, public/img.  This directory will contain other directories that contain the common name of a bird species.  Inside this folder are pictures of that given species, along with their generated HTML file.


