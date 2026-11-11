cask "anser" do
  arch arm: "aarch64", intel: "x86_64"

  version "0.1.41"
  sha256 arm:   "fb39e636e5ea12f0789de3ec92bae00374a2027e460a10a3b806bf1202883b2b",
         intel: "cdb56014afaffc6e909ac678c91688da93cf10ac8be1e67b3f3bd18f8021df42"

  url "https://github.com/ansermail/anser/releases/download/v#{version}/Anser_#{version}_#{arch}.dmg"
  name "Anser (雁信)"
  desc "Multi-account email client with local mail archiving"
  homepage "https://github.com/ansermail/anser"

  auto_updates true
  depends_on macos: :monterey

  app "雁信.app"
end
