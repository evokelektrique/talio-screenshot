const puppeteer = require('puppeteer')

const express = require("express")

// Database Initialization
const pgp = require('pg-promise')();
const connection = {
  host: process.env.DATABASE_HOST || "localhost",
  port: 5432,
  user: process.env.DATABASE_USER || "postgres",
  password: process.env.DATABASE_PASSWORD || "password",
  database: process.env.DATABASE_DB || "talio_dev",
  max: 10
}
const db = pgp(connection);

async function insert_elements(elements = []) {
  const columns = [
    "top", 
    "right", 
    "bottom", 
    "left", 
    "width", 
    "height", 
    "x", 
    "y", 
    "branch_id", 
    "device", 
    "path", 
    "tag_name", 
    "updated_at", 
    "inserted_at"
  ]
  const table_name = "elements"

  try {
      // our set of columns, to be created only once (statically), and then reused,
      // to let it cache up its formatting templates for high performance:
      const cs = new pgp.helpers.ColumnSet(columns, {table: table_name});

      // generating a multi-row insert query:
      const query = pgp.helpers.insert(elements, cs);
      //=> INSERT INTO "tmp"("col_a","col_b") VALUES('a1','b1'),('a2','b2')
          
      // executing the query:
      await db.none(query);
  } 
  catch(e) {
      // error
      console.log(e)
  }
}

    




async function waitTillHTMLRendered(page, timeout = 30000) {
  const checkDurationMsecs = 1000;
  const maxChecks = timeout / checkDurationMsecs;
  let lastHTMLSize = 0;
  let checkCounts = 1;
  let countStableSizeIterations = 0;
  const minStableSizeIterations = 3;

  while(checkCounts++ <= maxChecks){
    let html = await page.content();
    let currentHTMLSize = html.length; 

    let bodyHTMLSize = await page.evaluate(() => document.body.innerHTML.length);

    // console.log('last: ', lastHTMLSize, ' <> curr: ', currentHTMLSize, " body html size: ", bodyHTMLSize);

    if(lastHTMLSize != 0 && currentHTMLSize == lastHTMLSize) 
      countStableSizeIterations++;
    else 
      countStableSizeIterations = 0; //reset the counter

    if(countStableSizeIterations >= minStableSizeIterations) {
      console.log("\t>Page rendered fully");
      break;
    }

    lastHTMLSize = currentHTMLSize;
    await page.waitForTimeout(checkDurationMsecs);
  }  
}



















let Screenshot = {
  app_name: "Talio Screenshot Service",

  // Express Config
  app: express(),
  port: process.env.PORT || 3000,

  secret_key: process.env.SCREENSHOT_SECRET_KEY || "development_secret_key",

  // Puppeteer Config
  defaults: {
    timeout: 120000,
    quality: 70,
  },
  view_ports: {
    // desktop
    0: {  
      width: 1280,
      height: 640,
    },
    // tablet
    1: {  
      width: 800,
      height: 640,
      isMobile: true,
    },
    // mobile
    2: {  
      width: 380,
      height: 640,
      isMobile: true,
    }
  },
  user_agents: {
    // desktop
    0: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.77 Safari/537.36",
    // tablet
    1: "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.77 Mobile Safari/537.36",
    // mobile
    2: "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.77 Mobile Safari/537.36",
  },
  browser: null,
  context: null,

  flags: [
    // Important Flags
    "--disable-dev-shm-usage", 
    "--no-sandbox", 
    "--disable-setuid-sandbox",
    "--disable-background-networking",
    "--disable-default-apps",
    "--disable-extensions",
    "--disable-sync",
    "--disable-translate",
    "--mute-audio",
    "--safebrowsing-disable-auto-update",
  ],

  async init() {
    const __MODULE__ = Screenshot

    // Launch Browser
    this.browser = await puppeteer.launch({
      ignoreHTTPSErrors: true,
      args: __MODULE__.flags,
    });
    this.context = await this.browser.createIncognitoBrowserContext();

    this.app.get("/", async (req, res) => {
      console.log(req.query)
      const secret_key   = req.query.secret_key
      const url          = req.query.url
      const quality      = parseInt(req.query.quality) || __MODULE__.defaults.quality
      const device_type  = parseInt(req.query.device_type)
      const timeout      = parseInt(req.query.timeout) || __MODULE__.defaults.timeout
      const branch_id    = req.query.branch_id
      const redirect     = req.query.redirect == "yes" ? true : false

      // Validate URL Queries
      if(!url || !secret_key || secret_key !== __MODULE__.secret_key) {
        console.log(secret_key, url, quality, device_type, timeout)
        res.status(400)
        res.json({message: "Invalid Request"})
      } else {

        // Take a screenshot
        try {
          console.log("Opening", url)

          const page = await __MODULE__.context.newPage();
          await page.setCacheEnabled(false)
          await page.setViewport(__MODULE__.view_ports[device_type])
          await page.setDefaultTimeout(timeout)
          await page.setUserAgent(__MODULE__.user_agents[device_type])
          await page.goto(url);

          // If redirect was set, then wait for navigation to load
          if(redirect) {
            await page.waitForNavigation({ waitUntil: 'load', timeout: timeout})
          }

          console.log("\t>Waiting to page to completely load")

          await waitTillHTMLRendered(page)

          console.log("\t>Serializing Elements")
          const serialized_elements = await page.evaluate( ({device_type, branch_id}) => {
            function css_path(el) {
              if (!(el instanceof Element)) 
                return;
              var path = [];
              while (el.nodeType === Node.ELEMENT_NODE) {
                var selector = el.nodeName.toLowerCase();
                if (el.id) {
                  selector += '#' + el.id;
                  path.unshift(selector);
                  break;
                } else {
                  var sib = el, nth = 1;
                  while (sib = sib.previousElementSibling) {
                    if (sib.nodeName.toLowerCase() == selector)
                      nth++;
                  }
                  if (nth != 1)
                    selector += ":nth-of-type("+nth+")";
                }
                path.unshift(selector);
                el = el.parentNode;
              }
              return path.join(" > ");
            }

            function serialize(element, other) {
              const boundries = element.getBoundingClientRect()
              return {
                tag_name: element.tagName,
                top: boundries.top,
                right: boundries.right,
                bottom: boundries.bottom,
                left: boundries.left,
                x: boundries.x,
                y: boundries.y,
                width: boundries.width,
                height: boundries.height,
                path: css_path(element),
                ...other
              }
            }

            const serialized_elements = []
            const elements = document.getElementsByTagName("*")
            const excludes = ["html", "head", "body", "title", "meta", "link", "script", "style", "br"]
            const filtered = Array.from(elements).filter(function(value, index, arr){ 
              if(!excludes.includes(value.nodeName.toLocaleLowerCase())) { 
                return value
              }
            });
            filtered.forEach(el => {
              const time = new Date(Date.now()).toISOString()
              serialized_elements.push(
                serialize(el, {device: device_type, branch_id: branch_id, inserted_at: time, updated_at: time})
              )
            })
            return serialized_elements
          }, {device_type, branch_id})

          console.log("\t>Serialized_elements length", serialized_elements.length)

          console.log("\t>Inserting elements into DB")
          insert_elements(serialized_elements);

          const image = await page.screenshot({ 
            fullPage: true, 
            type: "jpeg", 
            quality: quality
          });
          await page.close()
          console.log("\t>Screenshot taken")

          // Show the screenshot
          res.writeHead(200, {
            'Content-Type': 'image/jpeg',
            'Content-Length': image.length
          });
          res.end(image); 

        } catch(error) {
          console.log("Error:", error)
          res.status(408)
          res.json({ message: "Timeout Reached" })
        }
      }
    })

    this.app.listen(this.port, () => {
      console.log(__MODULE__.app_name, "App Listening at", this.port)
    })
  },

  // // Opens the chromium and takes a screenshot with in a certain timeout
  // async screenshot(__MODULE__, url, device_type = "desktop", quality = 70, timeout) {
  //   return new Promise(async (resolve, reject) => {
  //     const page = await __MODULE__.context.newPage();
  //     await page.setCacheEnabled(false)
  //     await page.setViewport(__MODULE__.view_ports[device_type])
  //     await page.setDefaultTimeout(timeout)
  //     await page.setUserAgent(__MODULE__.user_agents[device_type])
  //     await page.goto(url);
  //     const image = await page.screenshot({ 
  //       fullPage: true, 
  //       type: "jpeg", 
  //       quality: quality
  //     });
  //     await page.close()
  //     resolve({ status: true, image: image })
  //   })
  // },
  
  async close_browser() {
    await this.browser.close();
  }
}


// Initialize Screenshot Object
Screenshot.init()


// 
// Handle Exit Events
// 

process.stdin.resume();//so the program will not close instantly

function exitHandler(options, exitCode) {
    if (options.cleanup) console.log('clean');
    if (exitCode || exitCode === 0) {
      console.log(exitCode)
      Screenshot.close_browser()
    }
    if (options.exit) process.exit()
}

//do something when app is closing
process.on('exit', exitHandler.bind(null,{cleanup:true}));

//catches ctrl+c event
process.on('SIGINT', exitHandler.bind(null, {exit:true}));

// catches "kill pid" (for example: nodemon restart)
process.on('SIGUSR1', exitHandler.bind(null, {exit:true}));
process.on('SIGUSR2', exitHandler.bind(null, {exit:true}));

//catches uncaught exceptions
process.on('uncaughtException', exitHandler.bind(null, {exit:true}));









// async function test() {
//   const url = "http://acity.ir/"
//   const device_type = 0
//   const branch_id = 71
//   const timeout = 120000
//   const redirect = true 

//   const browser = await puppeteer.launch({
//     ignoreHTTPSErrors: true,
//     args: Screenshot.flags,
//   });
//   const context = await browser.createIncognitoBrowserContext();

//   const page = await context.newPage();
//   await page.setCacheEnabled(false)
//   await page.setViewport(Screenshot.view_ports[device_type])
//   await page.setDefaultTimeout(timeout)
//   await page.setUserAgent(Screenshot.user_agents[device_type])
//   await page.goto(url);
//   // If redirect was set, then wait for navigation to load
//   if(redirect) {
//     await page.waitForNavigation({ waitUntil: 'load', timeout: timeout})
//   }

//   console.log("Waiting to page to completely load")

//   await waitTillHTMLRendered(page)

//   console.log("Serializing Elements...")
//   const serialized_elements = await page.evaluate( ({device_type, branch_id}) => {
//     function css_path(el) {
//       if (!(el instanceof Element)) 
//         return;
//       var path = [];
//       while (el.nodeType === Node.ELEMENT_NODE) {
//         var selector = el.nodeName.toLowerCase();
//         if (el.id) {
//           selector += '#' + el.id;
//           path.unshift(selector);
//           break;
//         } else {
//           var sib = el, nth = 1;
//           while (sib = sib.previousElementSibling) {
//             if (sib.nodeName.toLowerCase() == selector)
//               nth++;
//           }
//           if (nth != 1)
//             selector += ":nth-of-type("+nth+")";
//         }
//         path.unshift(selector);
//         el = el.parentNode;
//       }
//       return path.join(" > ");
//     }

//     function serialize(element, other) {
//       const boundries = element.getBoundingClientRect()
//       return {
//         tag_name: element.tagName,
//         top: boundries.top,
//         right: boundries.right,
//         bottom: boundries.bottom,
//         left: boundries.left,
//         x: boundries.x,
//         y: boundries.y,
//         width: boundries.width,
//         height: boundries.height,
//         path: css_path(element),
//         ...other
//       }
//     }

//     const serialized_elements = []
//     const elements = document.getElementsByTagName("*")
//     const excludes = ["html", "head", "body", "title", "meta", "link", "script", "style", "br"]
//     const filtered = Array.from(elements).filter(function(value, index, arr){ 
//       if(!excludes.includes(value.nodeName.toLocaleLowerCase())) { 
//         return value
//       }
//     });
//     filtered.forEach(el => {
//       const time = new Date(Date.now()).toISOString()
//       serialized_elements.push(
//         serialize(el, {device: device_type, branch_id: branch_id, inserted_at: time, updated_at: time})
//       )
//     })
//     return serialized_elements
//   }, {device_type, branch_id})

//   console.log(serialized_elements.length)


//   await page.screenshot({ 
//     path: 'screenshot.jpeg',
//     fullPage: true, 
//     type: "jpeg", 
//     quality: 70
//   });
//   console.log("Screenshot taken.")

//   // console.log("inserting elements into DB")
//   // insert_elements(serialized_elements);
//   // console.log("Insert Done")

//   await page.close()
// }
// // test()
