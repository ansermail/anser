cask "anser" do
  arch arm: "aarch64", intel: "x86_64"

  version "0.1.30"
  sha256 arm:   "0b061429b29361baddfa8788c8da3d62f8b440cc17a74cb9965f9196f0a7b6eb",
         intel: "ce902fbc10c678f991016ed43063dcbdb6b0745cc30bae4f9c093a40a35e3665"

  url "https://github.com/ansermail/anser/releases/download/v#{version}/Anser_#{version}_#{arch}.dmg"
  name "Anser (雁信)"
  desc "Multi-account email client with local mail archiving"
  homepage "https://github.com/ansermail/anser"

  auto_updates true
  depends_on macos: :monterey

  app "雁信.app"
end
