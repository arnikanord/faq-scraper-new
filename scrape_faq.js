import axios from 'axios';
import fs from 'fs/promises'; // Import the file system module

// --- Configuration ---
const urlsToScrape = [
  "https://technifol.de/halbautomatische-stretchmaschine-saving/",
  "https://technifol.de/",
  "https://technifol.de/halbautomatische-stretchmaschine-discovery/",
  "https://technifol.de/verpackungsfolien/",
  "https://www.cloudflare.com/learning/ssl/what-is-an-ssl-certificate/", // Example with English FAQ
  // Add more URLs as needed
];

const OUTPUT_FILE = 'faq_output.txt'; // Define the output file name

// --- Functions ---

/**
 * Fetches the content of a URL using the Jina AI Reader API (r.jina.ai).
 * @param {string} url - The original URL to fetch.
 * @returns {Promise<string|null>} - The content fetched by Jina Reader (usually Markdown), or null if an error occurs.
 */
async function getJinaReaderContent(url) {
  const jinaApiUrl = `https://r.jina.ai/${url}`;
  const headers = {
    'Accept': 'text/markdown,*/*;q=0.9', // Prefer Markdown
    'User-Agent': 'BoltFAQScraper/1.0' // Good practice to identify your bot
  };
  console.log(`Fetching: ${jinaApiUrl}`); // Progress indicator
  try {
    const response = await axios.get(jinaApiUrl, {
      headers: headers,
      timeout: 45000 // Increased timeout to 45 seconds
    });

    if (response.status >= 200 && response.status < 300) {
      return response.data;
    } else {
      console.error(`Error fetching ${url}: Status code ${response.status}`);
      return null;
    }
  } catch (error) {
    if (axios.isAxiosError(error)) {
        console.error(`Error fetching ${url}: ${error.message}`);
        if (error.response) {
            console.error(`Status: ${error.response.status}, Data: ${JSON.stringify(error.response.data).substring(0, 200)}...`);
        } else if (error.request) {
            console.error('No response received:', error.request);
        }
    } else {
        console.error('Error:', error.message);
    }
    return null;
  }
}

/**
 * Tries to extract the FAQ section from Markdown content based on observed patterns.
 * @param {string} markdownContent - The Markdown text (presumably from Jina Reader).
 * @returns {{title: string|null, body: string|null}} - An object containing the title and body, or nulls if not found.
 */
function extractFaqSection(markdownContent) {
  if (!markdownContent || typeof markdownContent !== 'string') {
    return { title: null, body: null };
  }

  // Jina often returns markdown with literal '\n' instead of actual newlines.
  // Replace them first for easier processing.
  const processedContent = markdownContent.replace(/\\n/g, '\n');
  const lines = processedContent.split('\n');

  let faqStartIndex = -1;
  let faqTitle = null;
  let faqBodyLines = [];
  let potentialTitleLine = null;

  // Find the start of the FAQ section (case-insensitive)
  for (let i = 0; i < lines.length; i++) {
    const trimmedLine = lines[i].trim();
    // Look for common headers or the simple "FAQ" line
    if (/^(#+\s*)?(Frequently Asked Questions|FAQ|Häufig gestellte Fragen|Fragen und Antworten)\s*$/i.test(trimmedLine)) {
       faqStartIndex = i;
       // Often the line *after* "FAQ" is the real title, or the matched line itself if it's a header
       if (trimmedLine.toLowerCase() === 'faq' && i + 1 < lines.length && lines[i+1].trim()) {
           potentialTitleLine = lines[i+1].trim();
           // Check if the potential title is followed by a separator line (---)
           if (i + 2 < lines.length && /^-{3,}$/.test(lines[i+2].trim())) {
               faqTitle = potentialTitleLine;
               faqStartIndex = i + 2; // Start collecting body after title and separator
           } else {
               // If not followed by separator, maybe the "FAQ" line itself was the title section start
               faqTitle = trimmedLine; // Use "FAQ" as title for now
               // Start collecting body from the next line
               faqStartIndex = i + 1;
           }
       } else {
           // It was likely a header like "## Frequently Asked Questions"
           faqTitle = trimmedLine.replace(/^(#+\s*)/, ''); // Clean the title
           // Check if the next line is a separator
            if (i + 1 < lines.length && /^-{3,}$/.test(lines[i+1].trim())) {
                 faqStartIndex = i + 2; // Start collecting after title and separator
            } else {
                 faqStartIndex = i + 1; // Start collecting right after the header
            }
       }
       break; // Found potential start
    }
  }

  if (faqStartIndex === -1) {
    return { title: null, body: null }; // No FAQ start found
  }

  // Collect lines until the end of the section
  // End conditions: another header of the same or higher level,
  // a significant separator (like --- or ***), or end of file.
  // We need to be careful not to stop too early if --- is used *within* Q&A.
  // Let's try a simpler approach: collect until a clear break like another H1/H2 or major separator.
  let headerLevel = 0;
  if (faqTitle && faqTitle.startsWith('#')) {
      headerLevel = (faqTitle.match(/^(#+)/)?.[0] || '').length;
  }


  for (let i = faqStartIndex; i < lines.length; i++) {
    const line = lines[i]; // Keep original spacing/formatting
    const trimmedLine = line.trim();

    // Stop conditions:
    // 1. Another Markdown header (e.g., ## New Section)
    const headerMatch = trimmedLine.match(/^(#+)\s+/);
    if (headerMatch && headerLevel > 0 && headerMatch[1].length <= headerLevel) {
        // Only stop if we had an initial header level defined
        break;
    }
    // 2. A very distinct separator (maybe less common now)
    // if (/^(\*{3,}|_{3,})$/.test(trimmedLine)) {
    //    break;
    // }
    // 3. Sometimes sections end implicitly. We might need more sophisticated logic
    //    or just capture a reasonable chunk. Let's capture until the next blank line
    //    followed by non-indented text, or a header.

    // Heuristic: If we encounter multiple blank lines, maybe the section ended.
    // if (trimmedLine === '' && i + 1 < lines.length && lines[i+1].trim() === '') {
    //     // Check if the line after the blank lines is non-empty
    //     if (i + 2 < lines.length && lines[i+2].trim() !== '') {
    //         // Potentially the end, let's stop here for now.
    //         // This is risky, might cut off content.
    //         // break;
    //     }
    // }


    faqBodyLines.push(line);
  }

  if (faqTitle && faqBodyLines.length > 0) {
    // Clean up the title again just in case
    const cleanedTitle = faqTitle.replace(/^(#+\s*)/, '').trim();
    const faqBody = faqBodyLines.join('\n').trim();
    return { title: cleanedTitle, body: faqBody };
  } else {
    return { title: null, body: null }; // No substantial body found
  }
}


/**
 * Processes a list of URLs, fetches content via Jina Reader, extracts FAQs,
 * and formats them for file output.
 * @param {string[]} urlList - Array of URLs to process.
 * @returns {Promise<string>} - A single string containing all results formatted for the output file.
 */
async function processUrls(urlList) {
  let fullOutput = '';
  for (const url of urlList) {
    console.log("-".repeat(40));
    console.log(`Processing URL: ${url}`);
    const content = await getJinaReaderContent(url);
    let result = '';

    if (content) {
      const { title: faqTitle, body: faqBody } = extractFaqSection(content);
      if (faqTitle && faqBody) {
        // Format for the file
        result = `URL: ${url}\nFAQ Section: ${faqTitle}\n${faqBody}`;
        console.log("--> FAQ Section Found");
      } else {
        result = `URL: ${url}\nFAQ Section: Not Found`;
        console.log("--> FAQ Section Not Found");
      }
    } else {
      result = `URL: ${url}\nFAQ Section: Error fetching content`;
      console.log("--> Error fetching content");
    }

    fullOutput += result + "\n\n---\n\n"; // Add separator between entries
    console.log("-".repeat(40));
    // Optional: Add a small delay between requests to be polite to the API
    await new Promise(resolve => setTimeout(resolve, 500)); // 500ms delay
  }
  return fullOutput;
}

// --- Main Execution ---
(async () => {
  console.log("Starting FAQ Scraper...");
  const finalOutput = await processUrls(urlsToScrape);

  console.log(`\nWriting results to ${OUTPUT_FILE}...`);
  try {
    await fs.writeFile(OUTPUT_FILE, finalOutput.trim() + '\n'); // Add trailing newline
    console.log(`Successfully wrote results to ${OUTPUT_FILE}`);
  } catch (err) {
    console.error(`Error writing file ${OUTPUT_FILE}:`, err);
  }

  console.log("Scraping complete.");
})();
